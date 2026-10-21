import type { Billing, Domain } from '@/lib/types';
import type { EngineConfig, SensitivityResult } from './types';
import { tierOf } from './percentile';
import { fitValue, monthlyCost, usageRate } from './cost';
import { solveKnapsack } from './knapsack';

/** The inputs the cut-shift check needs per perk. */
export interface SensitivityItem {
  id: string;
  billing: Billing;
  domain: Domain;
  unitCost: number;
  friction: number;
  weight: number;
  percentile: number;
}

/**
 * Shift both cuts together by +/- delta, re-tier, re-solve the base scenario, and report how much of the
 * base bundle survives. `retained` is the minimum over the two variants; null when the base bundle is empty.
 */
export function sensitivity(
  items: readonly SensitivityItem[],
  baseIds: readonly string[],
  cfg: EngineConfig,
  members: number,
  budget: number,
): SensitivityResult {
  if (baseIds.length === 0) return { retained: null, variants: [] };
  const baseSet = new Set(baseIds);
  const variants = [cfg.sensitivityDelta, -cfg.sensitivityDelta].map((delta) => {
    const cuts = { low: cfg.cuts.low + delta, high: cfg.cuts.high + delta };
    const knap = items.map((it) => {
      const u = usageRate(tierOf(it.percentile, cuts), it.friction, 'base', cfg);
      return {
        id: it.id,
        cost: monthlyCost(it, members, u),
        value: fitValue(it.weight, it.percentile, members, u) / members,
      };
    });
    const perkIds = solveKnapsack(knap, budget, cfg.quantUnit).ids;
    const kept = perkIds.filter((id) => baseSet.has(id)).length;
    return { delta, perkIds, retained: kept / baseIds.length };
  });
  return { retained: Math.min(...variants.map((v) => v.retained)), variants };
}
