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
      hypothesis: `Test whether offering ${p.name} to ${segmentLabel} changes usage versus a holdout group. Taste fit (${p.tier}) is a hypothesis, not a result.`,
      holdoutShare: cfg.holdout.share,
      holdoutMembers: Math.round(members * cfg.holdout.share),
      weeks: cfg.holdout.weeks,
      metric: 'usage rate difference versus holdout',
      roiFormula: '(incremental revenue - cost) / cost',
      successRule: 'incremental ROI > 0',
    };
  });
}
