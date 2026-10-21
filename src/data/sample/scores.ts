// SYNTHETIC: invented numbers, not Qloo data.
// Hand-written values used by sample mode and UI development. Rankings differ between the two example
// segments on purpose, and each domain has at most one candidate without data.
import type { CandidateScore, Segment } from '@/lib/types';

type Row = readonly [id: string, affinityA: number | null, affinityB: number | null, popularity: number];

const ROWS: readonly Row[] = [
  ['katz', 0.62, 0.81, 0.99],
  ['joes_pizza', 0.78, 0.55, 0.98],
  ['shake_shack', 0.7, 0.48, 1.0],
  ['levain', 0.85, 0.66, 0.97],
  ['russ_daughters', 0.52, null, 0.96],
  ['succession', 0.6, 0.79, 0.99],
  ['the_bear', 0.83, 0.52, 0.98],
  ['severance', 0.79, 0.47, 0.99],
  ['ted_lasso', 0.66, null, 0.97],
  ['bridgerton', 0.45, 0.86, 0.96],
  ['aesop', 0.88, 0.63, 0.97],
  ['nike', 0.58, 0.44, 1.0],
  ['lululemon', 0.81, 0.5, 0.98],
  ['peloton', 0.49, 0.41, 0.96],
  ['warby_parker', null, 0.58, 0.95],
  ['atomic_habits', 0.57, 0.7, 1.0],
  ['dune', 0.68, 0.74, 0.98],
  ['sapiens', 0.5, 0.83, 0.97],
  ['midnight_library', 0.86, 0.56, 0.96],
  ['evelyn_hugo', 0.64, 0.77, 0.97],
];

/** Per-chip share of the affinity, so the "contribution by interest chip" rows have something to show. */
const CHIP_SHARES: readonly number[] = [0.5, 0.3, 0.2];

/**
 * Synthetic scores for any segment. Example B uses the second column; every other segment (including a
 * custom one) reuses the first, with chip tokens taken from the segment passed in.
 */
export function sampleScoresFor(segment: Segment): CandidateScore[] {
  const col = segment.id === 'example_b' ? 2 : 1;
  return ROWS.map((row): CandidateScore => {
    const id = row[0];
    const affinity = row[col];
    if (affinity === null) {
      // The hand-written gaps: most are "not returned"; one Example B title is "no match".
      const noMatch = id === 'ted_lasso' && segment.id === 'example_b';
      return {
        candidateId: id,
        status: noMatch ? 'no_match' : 'no_data',
        reason: noMatch ? 'no_match' : 'not_returned',
        affinity: null,
        popularity: null,
        explain: [],
      };
    }
    return {
      candidateId: id,
      status: 'ok',
      affinity,
      popularity: row[3],
      explain: segment.interests.map((chip, i) => ({
        token: chip.token,
        score: Math.round(affinity * (CHIP_SHARES[i] ?? 0.1) * 1000) / 1000,
      })),
    };
  });
}
