import type { FitTier } from '@/lib/types';

const TIER_STYLE: Record<FitTier, string> = {
  high: 'border border-bottle bg-bottle text-paper',
  mid: 'border border-bottle text-bottle',
  low: 'border border-dashed border-sienna text-sienna',
};

/** Taste-match grade as a square chip: High is filled, Mid outlined, Low dashed in sienna. */
export function TierChip({ tier, dots, label }: { tier: FitTier; dots: string; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-[3px] text-[11px] font-semibold uppercase leading-[1.4] tracking-[0.14em] ${TIER_STYLE[tier]}`}>
      <span aria-hidden className="tracking-normal opacity-70">{dots}</span>
      {label}
    </span>
  );
}
