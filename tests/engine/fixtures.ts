import type { Candidate, CandidateScore, Domain, RunInput } from '@/lib/types';

/** Hand-made synthetic data (the worked example in the engine design). No Qloo data. */
export const SEGMENT: RunInput['segment'] = { id: 'example_a', label: 'Test segment', age: '25_to_29', interests: [] };

export function cand(id: string, name: string, domain: Domain, unitCost: number, billing: 'per_use' | 'fixed' = 'per_use', friction = 1): Candidate {
  return { id, name, domain, unitCost, billing, friction };
}

export function score(candidateId: string, affinity: number | null, popularity: number | null, status: CandidateScore['status'] = 'ok'): CandidateScore {
  return { candidateId, status, affinity, popularity, explain: [] };
}

export const EXAMPLE_CANDIDATES: Candidate[] = [
  cand('P1', 'Alpha Cafe', 'place', 1),
  cand('P2', 'Beta Diner', 'place', 2),
  cand('P3', 'Gamma Bakery', 'place', 1, 'fixed'),
  cand('P4', 'Delta Grill', 'place', 1),
  cand('B1', 'Echo Gear', 'brand', 3),
  cand('B2', 'Foxtrot Wear', 'brand', 5),
];

export const EXAMPLE_SCORES: CandidateScore[] = [
  score('P1', 0.9, 0.99),
  score('P2', 0.8, 0.98),
  score('P3', 0.7, 1.0),
  score('P4', null, null, 'no_data'),
  score('B1', 0.85, 0.97),
  score('B2', 0.75, 0.97),
];

export function exampleInput(over: Partial<RunInput> = {}): RunInput {
  return { segment: SEGMENT, candidates: EXAMPLE_CANDIDATES, budget: 250, members: 100, ...over };
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
