import type { CandidateOverride, ExplanationItem, RunEvent, RunStage } from '@/lib/api/types';
import type { AgentTraceStep, ApiError, CandidateScore, Domain, FitTier, LedgerEntry, RunInput, RunMeta, Segment } from '@/lib/types';
import type { EngineConfig } from './engine';

export type SegmentKey = 'example_a' | 'example_b' | 'custom';
export type StageState = { status: 'start' | 'done' | 'skip' | 'error'; ms?: number };
export type DomainStatusMap = Record<Domain, 'ok' | 'failed' | 'empty'>;

/** Everything the server sent for one run, plus the inputs it was run against. */
export interface RunData {
  runId: number;
  snapshot: { input: RunInput; cfg: EngineConfig; hash: string };
  scores?: CandidateScore[];
  qlooLedger?: LedgerEntry[];
  domainStatus?: DomainStatusMap;
  meta?: RunMeta;
  llm?: { status: 'ok' | 'failed'; picks: string[]; dropped: string[] };
  explanations?: ExplanationItem[];
  trace?: AgentTraceStep[];
}

export interface AskState { questionId: string; question: string; options: { token: string; name: string; hint?: string }[] }

export interface CompareState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  other?: { segment: Segment; scores: CandidateScore[] };
  error?: ApiError;
}

export interface AppState {
  mode: 'live' | 'sample';
  active: SegmentKey;
  custom: Segment;
  overrides: Record<string, CandidateOverride>;
  budget: number;
  members: number;
  usage: Record<FitTier, number>;
  weights: Record<Domain, number>;
  includeLlm: boolean;
  answers: Record<string, string>;
  phase: 'idle' | 'running' | 'done' | 'error';
  stages: Partial<Record<RunStage, StageState>>;
  error: ApiError | null;
  ask: AskState | null;
  /** The run in flight (or just finished). */
  current: RunData | null;
  /** The latest run that produced scores; stays on screen (dimmed) while a new run is in flight. */
  shown: RunData | null;
  compare: CompareState;
}

export type Action =
  | { type: 'set_mode'; mode: 'live' | 'sample' }
  | { type: 'select_segment'; key: SegmentKey; segment: Segment }
  | { type: 'edit_custom'; segment: Segment }
  | { type: 'edit_candidate'; id: string; override: CandidateOverride }
  | { type: 'set_include_llm'; value: boolean }
  | { type: 'set_budget'; value: number }
  | { type: 'set_members'; value: number }
  | { type: 'set_usage'; tier: FitTier; value: number }
  | { type: 'set_weight'; domain: Domain; value: number }
  | { type: 'set_answer'; questionId: string; token: string }
  | { type: 'run_start'; runId: number; snapshot: RunData['snapshot'] }
  | { type: 'event'; runId: number; event: RunEvent }
  | { type: 'run_fail'; runId: number; error: ApiError }
  | { type: 'run_end'; runId: number }
  | { type: 'compare_start' }
  | { type: 'compare_ready'; other: NonNullable<CompareState['other']> }
  | { type: 'compare_fail'; error: ApiError };

export function initialState(init: { mode: 'live' | 'sample'; custom: Segment; budget: number; members: number; usage: Record<FitTier, number> }): AppState {
  return {
    mode: init.mode, active: 'example_a', custom: init.custom, overrides: {}, budget: init.budget, members: init.members, usage: init.usage,
    weights: { place: 1, tv_show: 1, brand: 1, book: 1 }, includeLlm: true, answers: {}, phase: 'idle', stages: {}, error: null, ask: null,
    current: null, shown: null, compare: { phase: 'idle' },
  };
}

function applyEvent(run: RunData, e: RunEvent): RunData {
  switch (e.type) {
    case 'scores': return { ...run, scores: e.scores, qlooLedger: e.qlooLedger, domainStatus: e.domainStatus, meta: e.meta };
    case 'llm_alone': return { ...run, llm: { status: e.status, picks: e.picks, dropped: e.dropped } };
    case 'explanations': return { ...run, explanations: e.items };
    case 'trace': return { ...run, trace: e.steps };
    case 'done': return { ...run, meta: e.meta };
    default: return run;
  }
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set_mode': return { ...s, mode: a.mode, error: null, compare: { phase: 'idle' } };
    case 'select_segment': return { ...s, active: a.key, custom: a.key === 'custom' ? a.segment : s.custom, answers: {}, compare: { phase: 'idle' } };
    case 'edit_custom': return { ...s, active: 'custom', custom: a.segment, answers: {}, compare: { phase: 'idle' } };
    case 'edit_candidate': return { ...s, overrides: { ...s.overrides, [a.id]: a.override } };
    case 'set_include_llm': return { ...s, includeLlm: a.value };
    case 'set_budget': return { ...s, budget: a.value };
    case 'set_members': return { ...s, members: a.value };
    case 'set_usage': return { ...s, usage: { ...s.usage, [a.tier]: a.value } };
    case 'set_weight': return { ...s, weights: { ...s.weights, [a.domain]: a.value } };
    case 'set_answer': return { ...s, answers: { ...s.answers, [a.questionId]: a.token }, ask: null };
    case 'run_start':
      return { ...s, phase: 'running', stages: {}, error: null, ask: null, current: { runId: a.runId, snapshot: a.snapshot }, compare: { phase: 'idle' } };
    case 'event': {
      if (!s.current || s.current.runId !== a.runId) return s;
      const e = a.event;
      if (e.type === 'stage') return { ...s, stages: { ...s.stages, [e.stage]: { status: e.status, ms: e.ms } } };
      if (e.type === 'ask_user') return { ...s, phase: 'idle', ask: { questionId: e.questionId, question: e.question, options: e.options } };
      if (e.type === 'error') return { ...s, phase: 'error', error: e.error };
      const current = applyEvent(s.current, e);
      return { ...s, current, shown: current.scores ? current : s.shown, phase: e.type === 'done' ? 'done' : s.phase };
    }
    case 'run_fail': return s.current?.runId === a.runId ? { ...s, phase: 'error', error: a.error } : s;
    case 'run_end': return s.current?.runId === a.runId && s.phase === 'running' ? { ...s, phase: 'done' } : s;
    case 'compare_start': return { ...s, compare: { phase: 'loading' } };
    case 'compare_ready': return { ...s, compare: { phase: 'ready', other: a.other } };
    case 'compare_fail': return { ...s, compare: { phase: 'error', error: a.error } };
  }
}
