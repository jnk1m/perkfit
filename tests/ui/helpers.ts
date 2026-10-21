import { CANDIDATES, DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { sampleScoresFor } from '@/data/sample/scores';
import type { CandidateScore, DataSource, RunInput } from '@/lib/types';
import { DEFAULTS } from '@/lib/ui/engine';
import { toViewModel } from '@/lib/ui/viewModel';

export function sampleInput(): RunInput {
  return { segment: EXAMPLE_SEGMENTS[0], candidates: [...CANDIDATES], budget: DEFAULT_BUDGET, members: DEFAULT_MEMBERS };
}

export function buildVm(dataSource: DataSource, scores?: CandidateScore[]) {
  const input = sampleInput();
  const s = scores ?? sampleScoresFor(input.segment);
  return toViewModel({
    input, cfg: DEFAULTS, scores: s, dataSource, snapshot: { input, cfg: DEFAULTS, scores: s },
    explanationsPending: false, stale: false,
  });
}

/** Every candidate without data, so the engine cannot judge anything. */
export function emptyScores(): CandidateScore[] {
  return CANDIDATES.map((c) => ({ candidateId: c.id, status: 'no_data', reason: 'not_returned', affinity: null, popularity: null, explain: [] }));
}
