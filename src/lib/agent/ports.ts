import type { LanguageModel } from 'ai';
import type { Candidate, Domain, InterestChip, Segment } from '@/lib/types';
import type { DomainScoreResult, RunContext as QlooRunContext } from '@/lib/qloo/types';
import type { LlmClient } from '@/lib/llm/client';
import type { LlmAloneCache } from '@/lib/llm/llm-alone';
import type { TemplateItem } from '@/lib/llm/validator';

export interface ChipOption {
  token: string;
  name: string;
  hint?: string;
}

export type ChipResolution =
  /** `token` is the chip token to score with (unchanged for known chips, the picked option otherwise). */
  | { status: 'resolved'; token: string }
  | { status: 'ambiguous'; options: ChipOption[] }
  | { status: 'no_match' }
  | { status: 'unavailable'; detail: string };

export interface CandidateResolution {
  status: 'resolved' | 'ambiguous' | 'no_match' | 'unavailable';
  matchedName?: string;
}

/** What the agent needs from the Qloo layer. `createQlooPort` adapts the real service. */
export interface QlooPort {
  createRunContext(deadlineMs: number): QlooRunContext;
  /** `answer` is an option token the user picked for this chip in an earlier `ask_user`. */
  resolveChip(chip: InterestChip, answer: string | undefined, ctx: QlooRunContext): Promise<ChipResolution>;
  /** Re-search a catalog candidate (optionally under another name) and remember a confident match. */
  resolveCandidate(candidate: Pick<Candidate, 'id' | 'name' | 'domain'>, ctx: QlooRunContext): Promise<CandidateResolution>;
  scoreDomain(domain: Domain, segment: Segment, candidates: Candidate[], ctx: QlooRunContext): Promise<DomainScoreResult>;
}

/** The part of the Qloo `Precache` this module reads. `Precache` satisfies it. */
export interface PrecacheLike {
  readonly fetchedAt: string;
  readonly data: { readonly extras: Record<string, unknown> };
}

export interface Limits {
  /** Max LLM calls per run, loop steps included. */
  llmCalls: number;
  /** Max tool-loop steps. */
  steps: number;
  /** Max `resolve_candidate` retries per run. */
  resolveRetries: number;
  /** Whole-run deadline. */
  deadlineMs: number;
  /** Per LLM call timeout. */
  llmTimeoutMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  llmCalls: 8,
  steps: 16,
  resolveRetries: 2,
  deadlineMs: 45_000,
  llmTimeoutMs: 15_000,
};

export interface AgentDeps {
  qloo: QlooPort;
  /** Candidate catalog; defaults to the shared 20-candidate list. */
  candidates?: readonly Candidate[];
  precache?: PrecacheLike | null;
  /** Structured-output client for `explain` and `llm_alone`. Absent: those steps are skipped. */
  llm?: LlmClient | null;
  /** Model that drives the tool loop. Absent: the deterministic orchestrator runs alone. */
  loopModel?: LanguageModel | null;
  /** Force sample mode on/off. Default: request mode or `PERKFIT_MODE=sample`. */
  sampleMode?: boolean;
  /** Slot templates for sample mode and for runs without extras (pre-verified, re-validated on use). */
  sampleTemplates?: readonly TemplateItem[];
  llmAloneCache?: LlmAloneCache;
  limits?: Partial<Limits>;
  now?: () => number;
  /** Do not replay precache extras even when they match (used by the precache build script). */
  skipReplay?: boolean;
  /** Called once with what a finished run produced, for the precache build script. */
  onArtifacts?: (a: RunArtifacts) => void;
}

export interface RunArtifacts {
  inputHash: string;
  templates: TemplateItem[];
  llmAlone: { status: 'ok' | 'failed'; picks: string[]; dropped: string[] } | null;
  trace: import('@/lib/types').AgentTraceStep[];
}
