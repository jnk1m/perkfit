import { AGE_BANDS, DOMAINS } from '@/lib/types';
import type { InsightsQuery } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The verified bands plus the same pattern for the others (only three were seen live). */
const AGE_RE = /^\d{2}_to_\d{2}$/;

export const MAX_INTERESTS = 5;
export const MAX_CANDIDATES = 20;

export type GuardResult =
  | { ok: true; query: InsightsQuery; params: Record<string, string> }
  | { ok: false; detail: string };

export function normalizeId(id: string): string {
  return id.trim().toUpperCase();
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(normalizeId))];
}

/**
 * Pre-flight check for an insights call. Qloo answers 200 with an empty list to wrong parameters,
 * so a bad query must never reach the network. Builds the wire parameters itself: nothing else may.
 */
export function guardInsights(q: InsightsQuery): GuardResult {
  if (!DOMAINS.includes(q.type)) return { ok: false, detail: 'guard: filter.type not allowed' };
  const interests = uniqueIds(q.interestEntityIds);
  if (interests.length < 1 || interests.length > MAX_INTERESTS) {
    return { ok: false, detail: `guard: interests must be 1..${MAX_INTERESTS}, got ${interests.length}` };
  }
  if (!interests.every((id) => UUID_RE.test(id))) return { ok: false, detail: 'guard: interest id is not a uuid' };
  const age = q.age as string;
  if (!(AGE_BANDS as readonly string[]).includes(age) && !AGE_RE.test(age) && age !== '55_and_older') {
    return { ok: false, detail: 'guard: age band not allowed' };
  }
  if (q.gender !== undefined && q.gender !== 'male' && q.gender !== 'female') {
    return { ok: false, detail: 'guard: gender not allowed' };
  }
  const candidates = uniqueIds(q.candidateEntityIds);
  if (candidates.length < 1 || candidates.length > MAX_CANDIDATES) {
    return { ok: false, detail: `guard: candidates must be 1..${MAX_CANDIDATES}, got ${candidates.length}` };
  }
  if (!candidates.every((id) => UUID_RE.test(id))) return { ok: false, detail: 'guard: candidate id is not a uuid' };

  const query: InsightsQuery = { ...q, interestEntityIds: interests, candidateEntityIds: candidates };
  const params: Record<string, string> = {
    'filter.type': `urn:entity:${q.type}`,
    'signal.interests.entities': interests.join(','),
    'signal.demographics.age': age,
    'filter.results.entities': candidates.join(','),
    'feature.explainability': 'true',
    take: String(candidates.length),
  };
  if (q.gender) params['signal.demographics.gender'] = q.gender;
  return { ok: true, query, params };
}
