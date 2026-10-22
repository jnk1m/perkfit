import type { Headline } from '@/lib/types';
import type { Bundle, EngineConfig, PerkScore } from './types';
import { diffBundles } from './compare';
import { cmpStr, sum } from './util';

const usd = (x: number): string => `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/**
 * Headline independent of the popularity baseline's ordering for N, but its money is the baseline's.
 * L = perks in tier low, N = those not in the base bundle (skippedIds).
 * K = baseline bundle perks that are tier low; X = their base monthly cost, i.e. what a popularity-ordered
 * bundle spends on low-fit perks within the same budget. Range uses the same K, pessimistic to optimistic.
 */
export function buildHeadline(
  perks: readonly PerkScore[],
  base: Bundle,
  baseline: Bundle,
  cfg: EngineConfig,
  budget: number,
  totalCandidates: number,
): Headline {
  const inBase = new Set(base.perkIds);
  const inPop = new Set(baseline.perkIds);
  const low = perks.filter((p) => p.tier === 'low');
  const skipped = low.filter((p) => !inBase.has(p.candidateId)).sort((a, b) => cmpStr(a.candidateId, b.candidateId));
  const K = low.filter((p) => inPop.has(p.candidateId));
  const L = low.length;
  const N = skipped.length;
  const saveBase = sum(K.map((p) => p.scn.base.monthlyCost));
  const saveLow = sum(K.map((p) => p.scn.pessimistic.monthlyCost));
  const saveHigh = sum(K.map((p) => p.scn.optimistic.monthlyCost));
  const saveFixedPart = sum(K.filter((p) => p.billing === 'fixed').map((p) => p.scn.base.monthlyCost));
  const bundleCount = base.perkIds.length;
  const bundleCost = base.totalCost;
  const swapCount = diffBundles(base.perkIds, baseline.perkIds).n;
  const common = {
    n: N, lowFitTotal: L, skippedIds: skipped.map((p) => p.candidateId), saveBase, saveLow, saveHigh, saveFixedPart,
    bundleCount, bundleCost, swapCount,
  };

  if (perks.length === 0) {
    return {
      ...common,
      kind: 'insufficient',
      text: `Not enough Qloo data to judge (0 of ${totalCandidates} candidates scored)`,
      subtitle: '',
    };
  }
  if (bundleCount === 0) {
    const cheapest = Math.min(...perks.map((p) => p.scn.base.monthlyCost));
    return {
      ...common,
      kind: 'insufficient',
      text: `No perk fits a ${usd(budget)}/month budget`,
      subtitle: `The cheapest scored perk costs about ${usd(cheapest)}/month at assumed usage; ${perks.length} of ${totalCandidates} candidates were scored.`,
    };
  }
  const text = `Fund these ${bundleCount} perk${bundleCount === 1 ? '' : 's'} for ${usd(bundleCost)} of ${usd(budget)}/month`;
  if (L === 0 || N === 0) {
    const subtitle = swapCount === 0
      ? 'Popularity order lands on the same bundle.'
      : `Picking by popularity would swap ${swapCount} of them.`;
    return { ...common, kind: 'same', text, subtitle };
  }
  if (K.length === 0) {
    return {
      ...common,
      kind: 'all_in',
      text,
      subtitle: `Picking by popularity would swap ${swapCount} of them; it also avoids the ${L} low-fit perks.`,
    };
  }
  const subtitle =
    `Picking by popularity would swap ${swapCount} of them and put about ${usd(saveBase)} into perks with low taste fit for this segment ` +
    `(range ${usd(saveLow)} to ${usd(saveHigh)}).`;
  return { ...common, kind: saveBase < cfg.smallSavingRatio * budget ? 'skip_small' : 'skip', text, subtitle };
}
