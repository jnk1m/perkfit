import 'server-only';
import { createMemoryCache, type MemoryCache } from './cache';
import { createQlooClient, createRunContext, type QlooClient } from './client';
import { loadQlooConfig } from './config';
import { loadPrecacheFromEnv, type Precache } from './precache';
import { entityIdFromChipToken, resolveCandidate, searchChip } from './resolve';
import { scoreDomain, scoreSegment, type ScoreDeps } from './score';
import { fetchTransport, type QlooTransport } from './transport';
import type { Candidate, Domain, Segment } from '@/lib/types';
import type { DomainScoreResult, RunContext, SearchType } from './types';

export * from './types';
export { createRunContext } from './client';
export { chipToken, entityIdFromChipToken, normalizeName, pickEntity } from './resolve';
export { precacheKey, SCHEMA_VERSION } from './precache';

export interface QlooServiceOptions {
  transport?: QlooTransport;
  precache?: Precache | null;
  client?: QlooClient;
  memory?: MemoryCache;
  /** Extra candidate id -> entity id mappings found at runtime (agent re-resolution). */
  candidateIds?: Map<string, string | null>;
}

export interface QlooService {
  client: QlooClient;
  precache: Precache | null;
  /** Reason the PERKFIT_PRECACHE blob was rejected, if it was. */
  precacheError?: string;
  createRunContext: typeof createRunContext;
  scoreDomain(domain: Domain, segment: Segment, candidates: Candidate[], ctx: RunContext): Promise<DomainScoreResult>;
  scoreSegment(segment: Segment, candidates: Candidate[], ctx: RunContext): Promise<Record<Domain, DomainScoreResult>>;
  /** Search for a typed chip; the result says resolved, ambiguous (3 options) or no_match. */
  searchChip(q: string, type: SearchType, ctx: RunContext): ReturnType<typeof searchChip>;
  /** Re-resolve a candidate by name (agent tool); remember the result for later scoring in this process. */
  resolveCandidate(candidate: Pick<Candidate, 'id' | 'name' | 'domain'>, ctx: RunContext): Promise<Awaited<ReturnType<typeof resolveCandidate>>>;
}

/** Wires client, caches and scoring. Production uses env defaults; tests inject a transport and precache. */
export function createQlooService(opts: QlooServiceOptions = {}): QlooService {
  const loaded = opts.precache === undefined ? loadPrecacheFromEnv() : { precache: opts.precache, error: undefined };
  const precache = loaded.precache;
  const client = opts.client ?? createQlooClient({ transport: opts.transport ?? fetchTransport(loadQlooConfig()) });
  const runtimeIds = opts.candidateIds ?? new Map<string, string | null>();
  const deps: ScoreDeps = {
    client,
    memory: opts.memory ?? createMemoryCache(),
    precache,
    chipEntityId: (token) => precache?.chipEntityId(token) ?? entityIdFromChipToken(token),
    candidateEntityId: (id) => (runtimeIds.has(id) ? runtimeIds.get(id) : precache?.candidateEntityId(id)),
  };
  return {
    client,
    precache,
    precacheError: loaded.error,
    createRunContext,
    scoreDomain: (d, s, c, ctx) => scoreDomain(deps, d, s, c, ctx),
    scoreSegment: (s, c, ctx) => scoreSegment(deps, s, c, ctx),
    searchChip: (q, t, ctx) => searchChip(client, q, t, ctx),
    async resolveCandidate(candidate, ctx) {
      const out = await resolveCandidate(client, candidate, ctx);
      if (out.pick.kind === 'resolved') runtimeIds.set(candidate.id, out.pick.entity.entityId);
      else if (out.pick.kind === 'no_match' && (out.envelope.code === 'ok' || out.envelope.code === 'empty')) runtimeIds.set(candidate.id, null);
      return out;
    },
  };
}

let singleton: QlooService | undefined;

/** Process-wide service built from the environment. */
export function getQlooService(): QlooService {
  singleton ??= createQlooService();
  return singleton;
}
