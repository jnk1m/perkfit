import type { RunResult } from '@/lib/engine';
import type { Domain, FitTier } from '@/lib/types';

/** One dot of the "two rulers" chart: the same perk on the popularity ruler and on the taste-match ruler. */
export interface ChartPoint {
  id: string;
  name: string;
  domain: Domain;
  /** 0..1, null when Qloo returned no popularity for this perk. */
  popularity: number | null;
  /** Taste-match percentile within its category, 0..1. */
  percentile: number;
  tier: FitTier;
  /** In the base-scenario best bundle. */
  inBundle: boolean;
}

/** Every scored perk of a run (perks without a judgement are not on the taste ruler). Order follows the engine. */
export function chartPoints(result: RunResult): ChartPoint[] {
  const inBundle = new Set(result.bundle.byScenario.base.perkIds);
  return result.perks.map((p) => ({
    id: p.candidateId,
    name: p.name,
    domain: p.domain,
    popularity: p.popularity,
    percentile: p.percentile,
    tier: p.tier,
    inBundle: inBundle.has(p.candidateId),
  }));
}
