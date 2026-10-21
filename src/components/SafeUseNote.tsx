export const SAFE_USE_FOOTER =
  'Qloo results here are aggregate taste affinities for a customer segment. They say nothing about any individual and are not evidence of identity, finances, credit, or future behavior. Do not use this tool for credit, eligibility, or other high-impact decisions. Usage rates and costs are editable assumptions; verify with a holdout test.';
export const SAFE_USE_WHY = 'Source: Qloo aggregate taste affinity for the segment above. Not a prediction about any person.';

export function SafeUseNote({ variant }: { variant: 'footer' | 'why' }) {
  if (variant === 'why') return <p className="mt-2 text-xs text-ink/75">{SAFE_USE_WHY}</p>;
  return <footer className="mt-10 border-t-2 border-ink pt-4 text-xs leading-5 text-ink/80">{SAFE_USE_FOOTER}</footer>;
}
