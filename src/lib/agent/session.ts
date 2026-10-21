import type { RunEvent, RunRequest, RunStage } from '@/lib/api/types';
import { configFromRequest } from '@/lib/engine';
import type { EngineConfig, RunResult } from '@/lib/engine';
import type { Ledger } from '@/lib/ledger';
import type { ExplainOutcome } from '@/lib/llm/explain';
import type { LlmAloneResult } from '@/lib/llm/llm-alone';
import type { RunContext as QlooRunContext, DomainScoreResult } from '@/lib/qloo/types';
import type { AgentTraceStep, Candidate, CandidateScore, DataSource, Domain, RunInput, RunMeta, Segment } from '@/lib/types';
import { DOMAINS } from '@/lib/types';
import { DEFAULT_LIMITS, type AgentDeps, type ChipResolution, type Limits } from './ports';
import type { RunExtras } from './extras';

export class RunFailure extends Error {
  constructor(
    readonly code: 'invalid_request' | 'qloo_unavailable' | 'qloo_rate_limited' | 'timeout' | 'internal',
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'RunFailure';
  }
}

export type LlmAloneOutcome =
  | { status: 'ok'; result: LlmAloneResult }
  | { status: 'failed'; detail: string }
  | { status: 'skipped' };

/** Mutable state of one run. Created per request, never shared. */
export class RunSession {
  readonly limits: Limits;
  readonly startedAt: number;
  readonly deadlineAt: number;
  readonly candidates: Candidate[];
  readonly sample: boolean;
  readonly qctx: QlooRunContext;
  readonly engineConfig: Partial<EngineConfig>;
  /** Replay extras when this run's input hash matched the precache. */
  replay: RunExtras | null = null;

  /** Segment used for scoring; chip tokens may be swapped after a disambiguation. */
  segment: Segment;
  readonly chips = new Map<string, ChipResolution>();
  readonly domainResults = new Map<Domain, DomainScoreResult>();
  resolveRetries = 0;

  run: RunResult | null = null;
  ledger: Ledger | null = null;
  qlooEntries: import('@/lib/types').LedgerEntry[] = [];
  scoresEmitted = false;
  llmAlone: LlmAloneOutcome | null = null;
  explain: ExplainOutcome | null = null;
  explainCached: { passed: number; total: number } | null = null;
  holdoutDone = false;
  asked = false;

  readonly trace: AgentTraceStep[] = [];
  loopCalls = 0;
  innerCalls = 0;
  loopAttempted = false;
  inFallback = false;

  constructor(
    readonly req: RunRequest,
    readonly deps: AgentDeps,
    readonly candidatesCatalog: readonly Candidate[],
    readonly emit: (e: RunEvent) => void,
    sample: boolean,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.deadlineAt = this.startedAt + this.limits.deadlineMs;
    this.sample = sample;
    this.candidates = candidatesCatalog.map((c) => {
      const o = req.candidateOverrides[c.id];
      return o ? { ...c, unitCost: o.unitCost, billing: o.billing, friction: o.friction } : { ...c };
    });
    this.segment = req.segment;
    this.qctx = deps.qloo.createRunContext(this.limits.deadlineMs);
    this.engineConfig = configFromRequest(req);
  }

  readonly now: () => number;

  get input(): RunInput {
    return {
      segment: this.segment,
      candidates: this.candidates,
      budget: this.req.budget,
      members: this.req.members,
      domainWeights: this.req.domainWeights,
    };
  }

  /** The input as the client sent it (chip tokens unswapped). Its hash keys the precache extras. */
  get requestInput(): RunInput {
    return { ...this.input, segment: this.req.segment };
  }

  get useLlm(): boolean {
    return this.req.includeLlm && !this.sample && !!this.deps.llm && !this.replay;
  }

  remainingMs(): number {
    return this.deadlineAt - this.now();
  }

  /** LLM budget: loop steps plus inner calls. */
  get llmCalls(): number {
    return this.loopCalls + this.innerCalls;
  }

  /** Gate for inner LLM calls (explain, llm_alone). False when the run budget or deadline is spent. */
  gate = (): boolean => {
    if (this.llmCalls >= this.limits.llmCalls) return false;
    if (this.remainingMs() < 1_000) return false;
    this.innerCalls += 1;
    return true;
  };

  llmTimeout = (): number => Math.max(1_000, Math.min(this.limits.llmTimeoutMs, this.remainingMs()));

  /** Inner LLM calls still to come, reserved so the tool loop cannot spend them. */
  pendingInnerCalls(): number {
    let n = 0;
    if (this.useLlm && this.llmAlone === null) n += 1;
    if (this.useLlm && this.explain === null) n += 2;
    return n;
  }

  allDomainsScored(): boolean {
    return DOMAINS.every((d) => this.domainResults.has(d));
  }

  chipsResolved(): boolean {
    return this.req.segment.interests.every((c) => this.chips.get(c.token)?.status === 'resolved');
  }

  allScores(): CandidateScore[] {
    const byId = new Map<string, CandidateScore>();
    for (const d of DOMAINS) for (const s of this.domainResults.get(d)?.scores ?? []) byId.set(s.candidateId, s);
    return this.candidates.flatMap((c) => {
      const s = byId.get(c.id);
      return s ? [s] : [];
    });
  }

  stage(stage: RunStage, status: 'start' | 'done' | 'skip' | 'error', ms?: number): void {
    this.emit({ type: 'stage', stage, status, ...(ms !== undefined ? { ms } : {}) });
  }

  /** Record one tool execution in the agent trace. */
  record(tool: string, ok: boolean, startedAt: number, qlooCalls: number, summary: string): void {
    const prefix = this.inFallback && this.loopAttempted ? '[fallback] ' : '';
    this.trace.push({
      step: this.trace.length + 1,
      tool,
      ok,
      ms: Math.max(0, this.now() - startedAt),
      qlooCalls,
      summary: (prefix + summary).slice(0, 160),
    });
  }

  dataSource(): DataSource {
    if (this.sample) return 'sample';
    if (this.replay) return 'cache';
    const st = this.qctx.stats;
    return st.networkCalls === 0 && st.cacheHits > 0 ? 'cache' : 'live';
  }

  meta(llm: RunMeta['llm'], explanations: RunMeta['explanations']): RunMeta {
    const st = this.qctx.stats;
    const scores = this.allScores();
    const source = this.dataSource();
    return {
      dataSource: source,
      fetchedAt: source === 'cache' && this.deps.precache ? this.deps.precache.fetchedAt : new Date(this.now()).toISOString(),
      qlooCalls: source === 'cache' ? st.networkCalls + st.cacheHits : st.networkCalls,
      cacheHits: st.cacheHits,
      noData: scores.filter((s) => s.status === 'no_data').length,
      noMatch: scores.filter((s) => s.status === 'no_match').length,
      llm,
      agentSteps: this.replay ? this.replay.trace.length : this.trace.length,
      explanations,
      elapsedMs: Math.max(0, this.now() - this.startedAt),
    };
  }
}
