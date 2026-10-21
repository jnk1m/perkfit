import type { Candidate, CandidateScore, LedgerEntry, Segment } from '@/lib/types';
import type { DomainScoreResult } from '@/lib/qloo/types';

/**
 * Turn Qloo domain results into ledger entries. Ids use chip ordinals (c1..c5), never entity ids.
 * Only fields the product needs are kept: match, affinity, popularity, per-chip explain, no-data status.
 */
export function qlooEntriesFromDomainResults(
  results: readonly DomainScoreResult[],
  segment: Segment,
  candidates: readonly Candidate[],
): LedgerEntry[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const entries: LedgerEntry[] = [];
  let seq = 0;
  const push = (e: Omit<LedgerEntry, 'seq' | 'source'>) => entries.push({ ...e, source: 'qloo', seq: ++seq });
  const ordinal = (token: string) => {
    const i = segment.interests.findIndex((c) => c.token === token);
    return i >= 0 ? `c${i + 1}` : 'c0';
  };

  results.forEach((r, i) => {
    const call = `${r.callSummary.call}#${i + 1}`;
    const params = { ...r.callSummary.params, call_no: String(i + 1) };
    for (const s of r.scores) {
      if (!byId.has(s.candidateId)) continue;
      const base = { call, params, candidateId: s.candidateId, domain: r.domain };
      push({
        ...base,
        id: `qloo.match.${s.candidateId}`,
        field: 'match',
        value: s.status === 'no_match' ? 'no_match' : 'ok',
      });
      if (s.status === 'ok' && s.affinity !== null) {
        push({ ...base, id: `qloo.affinity.${s.candidateId}`, field: 'affinity', value: s.affinity, unit: 'ratio' });
        if (s.popularity !== null) {
          push({ ...base, id: `qloo.popularity.${s.candidateId}`, field: 'popularity', value: s.popularity, unit: 'ratio' });
        }
        for (const x of s.explain) {
          push({
            ...base,
            id: `qloo.explain.${s.candidateId}.${ordinal(x.token)}`,
            field: 'explain',
            value: x.score,
            unit: 'ratio',
            note: `chip ${ordinal(x.token)}`,
          });
        }
      } else {
        push({ ...base, id: `qloo.status.${s.candidateId}`, field: 'status', value: 'no_data', note: reasonNote(s) });
      }
    }
  });
  return entries;
}

function reasonNote(s: CandidateScore): string {
  return s.reason ?? (s.status === 'no_match' ? 'no_match' : 'no_data');
}
