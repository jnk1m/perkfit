import type { FitTier } from '@/lib/types';
import type { RunRequest } from '@/lib/api/types';
import type { EngineConfig } from './types';
import { validateConfig } from './validate';

/** Default assumptions. All are illustrative and editable. */
export const DEFAULT_CONFIG: Readonly<EngineConfig> = Object.freeze({
  tierUsage: Object.freeze({ high: 0.45, mid: 0.25, low: 0.1 }),
  scenarioMult: Object.freeze({ optimistic: 1.25, base: 1, pessimistic: 0.75 }),
  cuts: Object.freeze({ low: 1 / 3, high: 2 / 3 }),
  quantUnit: 10,
  holdout: Object.freeze({ share: 0.1, weeks: 4 }),
  smallSavingRatio: 0.01,
  sensitivityDelta: 0.1,
});

/** Merge a partial config over the defaults and validate it. Always returns fresh objects. */
export function mergeConfig(partial?: Partial<EngineConfig>): EngineConfig {
  const d = DEFAULT_CONFIG;
  const p = partial ?? {};
  const cfg: EngineConfig = {
    tierUsage: { ...d.tierUsage, ...p.tierUsage },
    scenarioMult: { ...d.scenarioMult, ...p.scenarioMult },
    cuts: { ...d.cuts, ...p.cuts },
    quantUnit: p.quantUnit ?? d.quantUnit,
    holdout: { ...d.holdout, ...p.holdout },
    smallSavingRatio: p.smallSavingRatio ?? d.smallSavingRatio,
    sensitivityDelta: p.sensitivityDelta ?? d.sensitivityDelta,
  };
  validateConfig(cfg);
  return cfg;
}

/** Move the editable usage rates of an API request into an engine config. */
export function configFromRequest(req: Pick<RunRequest, 'usage'>): Partial<EngineConfig> {
  if (!req.usage) return {};
  const tierUsage: Record<FitTier, number> = { high: req.usage.high, mid: req.usage.mid, low: req.usage.low };
  return { tierUsage };
}
