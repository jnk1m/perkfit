import { WRAP } from './Section';

export const SAFE_USE_FOOTER =
  'Qloo results here are aggregate taste affinities for a customer segment. They say nothing about any individual and are not evidence of identity, finances, credit, or future behavior. Do not use this tool for credit, eligibility, or other high-impact decisions. Usage rates and costs are editable assumptions; verify with a holdout test.';
export const SAFE_USE_WHY = 'Source: Qloo aggregate taste affinity for the segment above. Not a prediction about any person.';

export function SafeUseNote({ variant }: { variant: 'footer' | 'why' }) {
  if (variant === 'why') return <p className="mt-2 text-xs text-muted">{SAFE_USE_WHY}</p>;
  return (
    <footer className="field-wine mt-16">
      <div className={`${WRAP} grid gap-6 py-10 md:grid-cols-[1fr_2fr] md:gap-14`}>
        <p className="font-display text-[44px] leading-none">PerkFit</p>
        <p className="max-w-[720px] text-sm leading-[1.65] text-on-dark">{SAFE_USE_FOOTER}</p>
      </div>
    </footer>
  );
}
