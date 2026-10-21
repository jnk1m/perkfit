import type { Candidate, FitTier, Scenario } from '@/lib/types';
import type { EngineConfig } from './types';
import { mergeConfig } from './config';

/** Assumed share of members using a perk: min(1, tier rate * friction * scenario multiplier). */
export function usageRate(tier: FitTier, friction: number, scenario: Scenario, cfg: EngineConfig): number {
  return Math.min(1, cfg.tierUsage[tier] * friction * cfg.scenarioMult[scenario]);
}

/** Monthly cost: per-use scales with usage, fixed does not. */
export function monthlyCost(c: Pick<Candidate, 'unitCost' | 'billing'>, members: number, u: number): number {
  return c.billing === 'fixed' ? c.unitCost * members : c.unitCost * members * u;
}

/** Fit value v = weight * percentile * members * usage. */
export function fitValue(weight: number, percentile: number, members: number, u: number): number {
  return weight * percentile * members * u;
}

/** Cost at the mid-tier usage rate in the base scenario. Used to price a perk without a Qloo score. */
export function neutralCost(candidate: Candidate, members: number, config?: Partial<EngineConfig>): number {
  const cfg = mergeConfig(config);
  return monthlyCost(candidate, members, usageRate('mid', candidate.friction, 'base', cfg));
}
