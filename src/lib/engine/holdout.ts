import type { EngineConfig, HoldoutRow, PerkScore } from './types';

/** One fixed-template test row per base-bundle perk. Every value is an assumption, nothing is predicted. */
export function buildHoldout(
  perks: readonly PerkScore[],
  baseIds: readonly string[],
  segmentLabel: string,
  members: number,
  cfg: EngineConfig,
): HoldoutRow[] {
  const byId = new Map(perks.map((p) => [p.candidateId, p]));
  return baseIds.map((id) => {
    const p = byId.get(id) as PerkScore;
    return {
      candidateId: id,
      tier: p.tier,
      hypothesis: `Does offering ${p.name} raise usage for ${segmentLabel}? Compare with a ${Math.round(cfg.holdout.share * 100)}% group that doesn't get it. Taste match (${p.tier}) is a hypothesis, not a result.`,
      holdoutShare: cfg.holdout.share,
      holdoutMembers: Math.round(members * cfg.holdout.share),
      weeks: cfg.holdout.weeks,
      metric: 'usage vs. held-back group',
      roiFormula: '(incremental revenue - cost) / cost',
      successRule: 'extra value exceeds cost',
    };
  });
}
