/**
 * Shared domain types for PerkFit. Every layer (qloo, engine, ledger, api, ui) imports from here.
 * Keep this file free of runtime dependencies.
 */

export type Domain = 'place' | 'tv_show' | 'brand' | 'book';
export const DOMAINS: readonly Domain[] = ['place', 'tv_show', 'brand', 'book'] as const;

export type Billing = 'per_use' | 'fixed';
export type Scenario = 'optimistic' | 'base' | 'pessimistic';
export const SCENARIOS: readonly Scenario[] = ['optimistic', 'base', 'pessimistic'] as const;
export type FitTier = 'high' | 'mid' | 'low';

/** Qloo age bands. Only the first three were verified against the hackathon API; the rest follow the same pattern. */
export type AgeBand = '25_to_29' | '30_to_34' | '35_to_44' | '45_to_54' | '55_and_older';
export const AGE_BANDS: readonly AgeBand[] = ['25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'] as const;

/** A partner perk candidate. Unit cost, billing and friction are illustrative, editable assumptions. */
export interface Candidate {
  id: string;
  name: string;
  domain: Domain;
  unitCost: number;
  billing: Billing;
  friction: number;
}

/** An interest chip as the client sees it. The Qloo entity id stays server-side, keyed by `token`. */
export interface InterestChip {
  token: string;
  name: string;
}

export interface Segment {
  id: 'example_a' | 'example_b' | 'custom';
  label: string;
  age: AgeBand;
  gender?: 'male' | 'female';
  interests: InterestChip[];
}

export type NoDataReason = 'no_match' | 'not_returned' | 'no_affinity' | 'domain_error';

export interface CandidateScore {
  candidateId: string;
  status: 'ok' | 'no_data' | 'no_match';
  reason?: NoDataReason;
  /** results.entities[].query.affinity, 0..1 */
  affinity: number | null;
  /** results.entities[].popularity, 0..1 */
  popularity: number | null;
  /** query.explainability["signal.interests.entities"], keyed by chip token */
  explain: { token: string; score: number }[];
}

export type LedgerSource = 'qloo' | 'assumption' | 'calc' | 'sample';

export interface LedgerEntry {
  /** `{qloo|assume|calc|sample}.{field}.{subject}[.{variant}]` */
  id: string;
  seq: number;
  source: LedgerSource;
  call?: string;
  params?: Record<string, string>;
  candidateId?: string;
  domain?: Domain;
  scenario?: Scenario;
  field: string;
  value: number | string;
  unit?: 'ratio' | 'usd' | 'count' | 'tier';
  /** Required for `calc` entries: ledger ids this value was computed from. */
  dependsOn?: string[];
  note?: string;
}

export type DataSource = 'live' | 'cache' | 'sample';

export interface RunMeta {
  dataSource: DataSource;
  fetchedAt?: string;
  qlooCalls: number;
  cacheHits: number;
  noData: number;
  noMatch: number;
  llm: 'ok' | 'failed' | 'skipped' | 'cached';
  agentSteps: number;
  explanations: { total: number; passed: number; discarded: number };
  quota?: { liveRunsLeft: number };
  elapsedMs: number;
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'qloo_unavailable'
  | 'qloo_rate_limited'
  | 'quota_exceeded'
  | 'timeout'
  | 'internal';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryAfterSec?: number;
  field?: string;
  upstreamStatus?: number;
}

export interface RunInput {
  segment: Segment;
  candidates: Candidate[];
  budget: number;
  members: number;
  domainWeights?: Partial<Record<Domain, number>>;
}

export type HeadlineKind = 'skip' | 'skip_small' | 'same' | 'all_in' | 'insufficient';

export interface Headline {
  kind: HeadlineKind;
  /** low-fit perks not in the optimized bundle */
  n: number;
  /** all low-fit perks */
  lowFitTotal: number;
  skippedIds: string[];
  saveBase: number;
  saveLow: number;
  saveHigh: number;
  saveFixedPart: number;
  text: string;
  subtitle: string;
}

export interface AgentTraceStep {
  step: number;
  tool: string;
  ok: boolean;
  ms: number;
  qlooCalls: number;
  summary: string;
}
