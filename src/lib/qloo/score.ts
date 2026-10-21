import 'server-only';
import type { Candidate, CandidateScore, Domain, Segment } from '@/lib/types';
import { DOMAINS } from '@/lib/types';
import { lookupCache, type MemoryCache } from './cache';
import type { QlooClient } from './client';
import { TIMEOUTS } from './config';
import { failEnvelope } from './envelope';
import { normalizeId } from './guard';
import { precacheKey, type Precache } from './precache';
import type { DomainScoreResult, QlooEnvelope, RunContext, StoredDomainScore, StoredScore } from './types';

export interface ScoreDeps {
  client: QlooClient;
  memory: MemoryCache;
  precache: Precache | null;
  /** Chip token -> entity id. */
  chipEntityId: (token: string) => string | undefined;
  /** Candidate id -> entity id (null = no match). Runtime overrides win over the precache map. */
  candidateEntityId: (candidateId: string) => string | null | undefined;
  now?: () => number;
}

const inRange = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0 && n <= 1;

function noDataScore(candidateId: string, status: CandidateScore['status'], reason: CandidateScore['reason']): CandidateScore {
  return { candidateId, status, reason, affinity: null, popularity: null, explain: [] };
}

function fromStored(
  candidates: Candidate[],
  idOf: Map<string, string | null>,
  stored: StoredDomainScore,
  tokenOf: Map<string, string>,
): CandidateScore[] {
  const byEntity = new Map(stored.scores.map((s) => [s.entityId, s]));
  return candidates.map((c) => {
    const entityId = idOf.get(c.id);
    if (!entityId) return noDataScore(c.id, 'no_match', 'no_match');
    const s = byEntity.get(entityId);
    if (!s) return noDataScore(c.id, 'no_data', 'not_returned');
    if (s.status === 'no_data') return noDataScore(c.id, 'no_data', s.reason ?? 'no_affinity');
    return {
      candidateId: c.id,
      status: 'ok',
      affinity: s.affinity,
      popularity: s.popularity,
      explain: s.explain.flatMap((x) => {
        const token = tokenOf.get(x.entityId);
        return token ? [{ token, score: x.score }] : [];
      }),
    };
  });
}

/**
 * Scores one domain's candidates for one segment with a single /v2/insights call.
 * Lookup order: memory, precache, network. Missing data stays missing: nothing is filled or estimated.
 */
export async function scoreDomain(
  deps: ScoreDeps,
  domain: Domain,
  segment: Segment,
  candidates: Candidate[],
  ctx: RunContext,
): Promise<DomainScoreResult> {
  const now = deps.now ?? Date.now;
  const list = candidates.filter((c) => c.domain === domain);

  const callSummary = {
    call: 'GET /v2/insights',
    params: {
      'filter.type': domain,
      'signal.interests.entities': segment.interests.map((_, i) => `chip#${i + 1}`).join(','),
      'signal.demographics.age': segment.age,
      ...(segment.gender ? { 'signal.demographics.gender': segment.gender } : {}),
      'filter.results.entities': `n=${list.length}`,
    },
  };

  const count = (scores: CandidateScore[]) => {
    for (const s of scores) {
      if (s.status === 'no_data') ctx.stats.noData++;
      else if (s.status === 'no_match') ctx.stats.noMatch++;
    }
  };
  const failedAll = (envelope: QlooEnvelope<void>, reasonFor: (c: Candidate) => CandidateScore): DomainScoreResult => {
    const scores = list.map(reasonFor);
    count(scores);
    return { domain, envelope, scores, callSummary };
  };

  // Chip tokens -> entity ids. An unknown token is a client error, not a Qloo problem.
  const interestIds: string[] = [];
  const tokenOf = new Map<string, string>();
  for (const chip of segment.interests) {
    const id = deps.chipEntityId(chip.token);
    if (!id) {
      return failedAll(failEnvelope('no_signal', 0, { detail: `score ${domain}: unknown chip token` }), (c) =>
        noDataScore(c.id, 'no_data', 'domain_error'),
      );
    }
    interestIds.push(normalizeId(id));
    tokenOf.set(normalizeId(id), chip.token);
  }

  const idOf = new Map<string, string | null>();
  for (const c of list) {
    const id = deps.candidateEntityId(c.id);
    idOf.set(c.id, id ? normalizeId(id) : null);
  }
  const sentIds = [...new Set([...idOf.values()].filter((v): v is string => !!v))];
  if (sentIds.length === 0) {
    return failedAll(failEnvelope('empty', 0, { detail: `score ${domain}: no candidate has a Qloo match` }), (c) =>
      noDataScore(c.id, 'no_match', 'no_match'),
    );
  }

  const key = precacheKey({ age: segment.age, gender: segment.gender, interestEntityIds: interestIds }, sentIds);
  const hit = lookupCache(key, deps.memory, deps.precache);
  if (hit) {
    ctx.stats.cacheHits++;
    const scores = fromStored(list, idOf, hit.stored, tokenOf);
    count(scores);
    const envelope: QlooEnvelope<void> = { code: hit.stored.code, retryable: false, latencyMs: 0, source: hit.source };
    return { domain, envelope, scores, callSummary, stored: hit.stored, cacheKey: key };
  }

  const started = now();
  const env = await deps.client.insights(
    { type: domain, interestEntityIds: interestIds, age: segment.age, gender: segment.gender, candidateEntityIds: sentIds },
    ctx,
    { deadlineAt: Math.min(ctx.deadlineAt, started + TIMEOUTS.domainMs) },
  );
  const { data, ...envelope } = env;

  if (env.code === 'auth' || env.code === 'rate_limited' || env.code === 'upstream' || (!data && env.code !== 'empty')) {
    return failedAll(envelope, (c) => (idOf.get(c.id) ? noDataScore(c.id, 'no_data', 'domain_error') : noDataScore(c.id, 'no_match', 'no_match')));
  }

  const sent = new Set(sentIds);
  const returned = new Map((data ?? []).filter((e) => sent.has(e.entityId)).map((e) => [e.entityId, e]));
  const storedScores: StoredScore[] = sentIds.map((entityId) => {
    const e = returned.get(entityId);
    if (!e) return { entityId, status: 'no_data', reason: 'not_returned', affinity: null, popularity: null, explain: [] };
    if (!inRange(e.affinity)) return { entityId, status: 'no_data', reason: 'no_affinity', affinity: null, popularity: null, explain: [] };
    return {
      entityId,
      status: 'ok',
      affinity: e.affinity,
      popularity: inRange(e.popularity) ? e.popularity : null,
      explain: e.explain.filter((x) => tokenOf.has(x.entityId)),
    };
  });
  const stored: StoredDomainScore = { code: env.code === 'ok' ? 'ok' : env.code === 'empty' ? 'empty' : 'no_signal', scores: storedScores };
  deps.memory.set(key, stored);

  const scores = fromStored(list, idOf, stored, tokenOf);
  count(scores);
  return { domain, envelope, scores, callSummary, stored, cacheKey: key };
}

/** Scores all four domains in parallel. Each domain has its own 25 s budget inside the run deadline. */
export async function scoreSegment(
  deps: ScoreDeps,
  segment: Segment,
  candidates: Candidate[],
  ctx: RunContext,
): Promise<Record<Domain, DomainScoreResult>> {
  const results = await Promise.all(DOMAINS.map((d) => scoreDomain(deps, d, segment, candidates, ctx)));
  return Object.fromEntries(results.map((r) => [r.domain, r])) as Record<Domain, DomainScoreResult>;
}
