import type { Bundle, PerkScore } from './types';
import { cmpStr, sortIds, sum } from './util';

/**
 * Popularity-order baseline under the same assumptions: sort by raw popularity descending (null last),
 * then lower-cased name by code point, then id. Walk the list and take a perk when its base cost fits
 * the remaining budget; otherwise skip it and keep going.
 */
export function popularityBaseline(perks: readonly PerkScore[], budget: number): Bundle {
  const order = [...perks].sort((a, b) => {
    if (a.popularity === null && b.popularity !== null) return 1;
    if (a.popularity !== null && b.popularity === null) return -1;
    if (a.popularity !== null && b.popularity !== null && a.popularity !== b.popularity) return b.popularity - a.popularity;
    return cmpStr(a.name.toLowerCase(), b.name.toLowerCase()) || cmpStr(a.candidateId, b.candidateId);
  });
  let remaining = budget;
  const picked: PerkScore[] = [];
  for (const p of order) {
    const cost = p.scn.base.monthlyCost;
    if (cost <= remaining + 1e-9) {
      picked.push(p);
      remaining -= cost;
    }
  }
  const byId = [...picked].sort((a, b) => cmpStr(a.candidateId, b.candidateId));
  const totalCost = sum(byId.map((p) => p.scn.base.monthlyCost));
  return {
    scenario: 'popularity',
    perkIds: sortIds(byId.map((p) => p.candidateId)),
    totalCost,
    totalValue: sum(byId.map((p) => p.scn.base.value)),
    budgetUsedRatio: totalCost / budget,
  };
}
