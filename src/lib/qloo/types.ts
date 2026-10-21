import type { AgeBand, CandidateScore, Domain } from '@/lib/types';

/** Envelope codes (DESIGN decision H). */
export type QlooCode = 'ok' | 'empty' | 'no_signal' | 'auth' | 'rate_limited' | 'upstream';

export type EnvelopeSource = 'network' | 'memory' | 'precache';

/**
 * Every Qloo call returns one of these instead of throwing.
 * `detail` holds only status codes, domains, counts or schema paths. Never keys, headers or bodies.
 */
export interface QlooEnvelope<T = void> {
  code: QlooCode;
  retryable: boolean;
  data?: T;
  httpStatus?: number;
  latencyMs: number;
  source: EnvelopeSource;
  detail?: string;
}

/** Entity types /search accepts through this client. */
export type SearchType = Domain | 'artist' | 'movie' | 'podcast';
export const SEARCH_TYPES: readonly SearchType[] = ['place', 'tv_show', 'brand', 'book', 'artist', 'movie', 'podcast'] as const;

export interface SearchQuery {
  query: string;
  type: SearchType;
  take: number;
}

export interface SearchHit {
  /** Upper-case UUID. */
  entityId: string;
  name: string;
  types: string[];
  popularity: number | null;
  disambiguation?: string;
  city?: string;
  metro?: string;
}

export interface InsightsQuery {
  type: Domain;
  /** 1..5 chip entity ids. */
  interestEntityIds: string[];
  age: AgeBand;
  gender?: 'male' | 'female';
  /** 1..20 candidate entity ids. */
  candidateEntityIds: string[];
}

export interface InsightsEntity {
  entityId: string;
  name: string;
  subtype?: string;
  popularity: number | null;
  /** Raw value only if it is a finite number; range is checked by the scorer. */
  affinity: number | null;
  explain: { entityId: string; score: number }[];
}

export interface QlooStats {
  networkCalls: number;
  cacheHits: number;
  retries: number;
  noData: number;
  noMatch: number;
}

/** Per-run state: deadline, counters and the "stop calling" switch. */
export interface RunContext {
  deadlineAt: number;
  stats: QlooStats;
  /** Set after a 401 or three rate-limit responses in a row; later network calls are skipped. */
  abort?: { code: 'auth' | 'rate_limited' };
  consecutiveRateLimited: number;
}

/** What the scorer keeps per candidate in caches. Explain is keyed by chip entity id, not by chip token. */
export interface StoredScore {
  entityId: string;
  status: 'ok' | 'no_data';
  reason?: 'not_returned' | 'no_affinity';
  affinity: number | null;
  popularity: number | null;
  explain: { entityId: string; score: number }[];
}

export interface StoredDomainScore {
  code: 'ok' | 'empty' | 'no_signal';
  scores: StoredScore[];
}

export interface DomainScoreResult {
  domain: Domain;
  envelope: QlooEnvelope<void>;
  scores: CandidateScore[];
  /** For the ledger: no key, chip ordinals instead of ids, candidate count only. */
  callSummary: { call: string; params: Record<string, string> };
  /** Server-internal; used by the precache builder. */
  stored?: StoredDomainScore;
  /** Run-unit cache key for this call, when one could be built. */
  cacheKey?: string;
}
