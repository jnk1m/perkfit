import type { BundleDiff, BundleEval, CompareResult, RunResult, SegmentCompare } from './types';
import { sortIds, sum } from './util';

const r9 = (x: number): number => Math.round(x * 1e9) / 1e9;

/** Average ranks (ties share the mean rank), 1-based. */
function avgRanks(xs: readonly number[]): number[] {
  const v = xs.map(r9);
  const order = v.map((_, i) => i).sort((i, j) => v[i] - v[j] || i - j);
  const rank = new Array<number>(xs.length).fill(0);
  let a = 0;
  while (a < order.length) {
    let b = a;
    while (b + 1 < order.length && v[order[b + 1]] === v[order[a]]) b++;
    for (let k = a; k <= b; k++) rank[order[k]] = (a + b) / 2 + 1;
    a = b + 1;
  }
  return rank;
}

/** Spearman correlation. Null when fewer than 3 pairs or when either side has no variance. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const rx = avgRanks(xs);
  const ry = avgRanks(ys);
  const mx = sum(rx) / n;
  const my = sum(ry) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** How many of A's perks are not in B (n of m), plus kept, dropped and added ids. */
export function diffBundles(aIds: readonly string[], bIds: readonly string[]): BundleDiff {
  const a = new Set(aIds);
  const b = new Set(bIds);
  const kept = sortIds([...a].filter((id) => b.has(id)));
  const dropped = sortIds([...a].filter((id) => !b.has(id)));
  const added = sortIds([...b].filter((id) => !a.has(id)));
  return { n: dropped.length, m: a.size, kept, dropped, added };
}

/** Compare the base bundle with an arbitrary id list (e.g. an LLM-only pick). Costs use the base scenario. */
export function compareBundles(
  run: RunResult,
  otherIds: readonly string[],
  otherScores?: Record<string, number>,
): CompareResult & { eval: BundleEval } {
  const ids = sortIds(new Set(otherIds));
  const diff = diffBundles(run.bundle.byScenario.base.perkIds, ids);
  const perkById = new Map(run.perks.map((p) => [p.candidateId, p]));
  const deferredById = new Map(run.deferred.map((d) => [d.candidateId, d]));
  let cost = 0;
  let totalValue = 0;
  const lowFitIds: string[] = [];
  const unscoredIds: string[] = [];
  const unknownIds: string[] = [];
  for (const id of ids) {
    const p = perkById.get(id);
    const d = deferredById.get(id);
    if (p) {
      cost += p.scn.base.monthlyCost;
      totalValue += p.scn.base.value;
      if (p.tier === 'low') lowFitIds.push(id);
    } else if (d) {
      cost += d.neutralCost;
      unscoredIds.push(id);
    } else {
      unknownIds.push(id);
    }
  }
  let rho: number | null = null;
  let rhoN = 0;
  if (otherScores) {
    const pairs = run.perks.filter((p) => Number.isFinite(otherScores[p.candidateId]));
    rhoN = pairs.length;
    rho = spearman(pairs.map((p) => p.percentile), pairs.map((p) => otherScores[p.candidateId]));
  }
  return {
    diff,
    rho,
    rhoN,
    eval: { cost, withinBudget: cost <= run.budget + 1e-9, totalValue, lowFitIds, unscoredIds, unknownIds },
  };
}

/** Compare two runs of the same candidates and budget (segment swap): bundle diff plus percentile Spearman. */
export function compareSegments(a: RunResult, b: RunResult): SegmentCompare {
  const diff = diffBundles(a.bundle.byScenario.base.perkIds, b.bundle.byScenario.base.perkIds);
  const bById = new Map(b.perks.map((p) => [p.candidateId, p]));
  const common = a.perks.filter((p) => bById.has(p.candidateId));
  const rho = spearman(
    common.map((p) => p.percentile),
    common.map((p) => (bById.get(p.candidateId) as { percentile: number }).percentile),
  );
  return { aId: a.segmentId, bId: b.segmentId, diff, rho, rhoN: common.length };
}
