import type { Headline } from '@/lib/types';
import type { Bundle, EngineConfig, PerkScore } from './types';
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
  const common = { n: N, lowFitTotal: L, skippedIds: skipped.map((p) => p.candidateId), saveBase, saveLow, saveHigh, saveFixedPart };

  if (perks.length === 0 || base.perkIds.length === 0) {
    return {
      ...common,
      kind: 'insufficient',
      text: `Not enough Qloo data to judge (${perks.length} of ${totalCandidates} candidates scored)`,
      subtitle: '',
    };
  }
  if (L === 0) {
    return { ...common, kind: 'same', text: 'No low-fit perks among the scored candidates', subtitle: '' };
  }
  if (N === 0) {
    const all = L === 1 ? 'the 1 low-fit perk is' : `all ${L} low-fit perks are`;
    return { ...common, kind: 'same', text: `Nothing to skip: ${all} in the optimized bundle`, subtitle: '' };
  }
  const text = `Skip ${N} low-fit perk${N === 1 ? '' : 's'}`;
  if (K.length === 0) {
    return {
      ...common,
      kind: 'all_in',
      text,
      subtitle: `A popularity-ordered bundle avoids them too; ${L} of ${perks.length} candidates are low fit for this segment`,
    };
  }
  const subtitle =
    `A popularity-ordered bundle would spend about ${usd(saveBase)} of ${usd(budget)} on ${K.length} of them ` +
    `(range ${usd(saveLow)} to ${usd(saveHigh)}; fixed-fee ${usd(saveFixedPart)})`;
  return { ...common, kind: saveBase < cfg.smallSavingRatio * budget ? 'skip_small' : 'skip', text, subtitle };
}
