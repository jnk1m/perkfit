import type { FitTier } from '@/lib/types';

const EPS = 1e-9;
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * Mid-rank percentiles within one group: rank ascending by value (6-decimal ties share the average
 * rank), p = (rank - 0.5) / n. Output arrays align with the input order.
 */
export function midRankPercentiles(values: readonly number[]): { rank: number[]; p: number[] } {
  const n = values.length;
  const rounded = values.map(r6);
  const order = rounded.map((_, i) => i).sort((i, j) => rounded[i] - rounded[j] || i - j);
  const rank = new Array<number>(n).fill(0);
  let a = 0;
  while (a < n) {
    let b = a;
    while (b + 1 < n && rounded[order[b + 1]] === rounded[order[a]]) b++;
    const avg = (a + b) / 2 + 1;
    for (let k = a; k <= b; k++) rank[order[k]] = avg;
    a = b + 1;
  }
  return { rank, p: rank.map((r) => (r - 0.5) / n) };
}

/** Tier from a percentile: p < low is low, p >= high is high, otherwise mid (1e-9 tolerance). */
export function tierOf(p: number, cuts: { low: number; high: number }): FitTier {
  if (p < cuts.low - EPS) return 'low';
  if (p >= cuts.high - EPS) return 'high';
  return 'mid';
}
