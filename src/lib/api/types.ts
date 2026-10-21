/**
 * Client <-> server contract for /api/run (NDJSON stream), /api/compare and /api/search.
 * Owned jointly: the UI consumes these, the agent/orchestrator emits them.
 */
import type {
  AgentTraceStep,
  ApiError,
  Billing,
  CandidateScore,
  Domain,
  FitTier,
  LedgerEntry,
  RunMeta,
  Segment,
} from '@/lib/types';

export type RunMode = 'live' | 'sample';

export interface CandidateOverride {
  unitCost: number;
  billing: Billing;
  friction: number;
}

export interface RunRequest {
  mode: RunMode;
  segment: Segment;
  /** Only unit cost, billing and friction can be overridden; the catalog itself is fixed server-side. */
  candidateOverrides: Record<string, CandidateOverride>;
  budget: number;
  members: number;
  domainWeights?: Partial<Record<Domain, number>>;
  usage?: Record<FitTier, number>;
  includeLlm: boolean;
  /** Answers to a previous `ask_user` event, keyed by question id. */
  answers?: Record<string, string>;
}

export type RunStage =
  | 'resolve'
  | 'score_place'
  | 'score_tv_show'
  | 'score_brand'
  | 'score_book'
  | 'llm_alone'
  | 'optimize'
  | 'explain'
  | 'validate';

export type DomainStatus = 'ok' | 'failed' | 'empty';

export interface ExplanationItem {
  candidateId: string;
  /** Final sentence with slots substituted, or null when discarded. */
  sentence: string | null;
  status: 'verified' | 'discarded';
  /** Validator rule ids that failed (empty when verified). */
  failedRules: string[];
}

export type RunEvent =
  | { type: 'stage'; stage: RunStage; status: 'start' | 'done' | 'skip' | 'error'; ms?: number }
  | {
      type: 'scores';
      scores: CandidateScore[];
      qlooLedger: LedgerEntry[];
      domainStatus: Record<Domain, DomainStatus>;
      meta: RunMeta;
    }
  | { type: 'llm_alone'; status: 'ok' | 'failed'; picks: string[]; dropped: string[] }
  | { type: 'explanations'; items: ExplanationItem[] }
  | {
      type: 'ask_user';
      questionId: string;
      question: string;
      options: { token: string; name: string; hint?: string }[];
    }
  | { type: 'trace'; steps: AgentTraceStep[] }
  | { type: 'error'; error: ApiError }
  | { type: 'done'; meta: RunMeta };

export interface CompareRequest {
  mode: RunMode;
  against: Array<'example_a' | 'example_b' | 'example_a_near'>;
  candidateOverrides: Record<string, CandidateOverride>;
}

export interface CompareResponse {
  results: { segmentId: string; segment: Segment; scores: CandidateScore[]; qlooLedger: LedgerEntry[] }[];
  meta: RunMeta;
}

export interface SearchResponse {
  results: { token: string; name: string; type: string; hint?: string }[];
}
