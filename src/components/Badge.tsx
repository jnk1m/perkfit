import type { BadgeKind } from '@/lib/ui/viewModel';

/** On paper or sand. QLOO bottle fill, CALC ink outline, ASSUMPTION sienna fill, SAMPLE wine outline with hatching. */
const STYLE: Record<BadgeKind, string> = {
  qloo: 'bg-bottle text-paper',
  calc: 'border border-ink text-ink',
  assumption: 'bg-sienna text-paper',
  sample: 'hatch border border-wine text-wine',
};
/** On the ink field: fills switch to the tints so each kind keeps its identity. */
const INK_STYLE: Record<BadgeKind, string> = {
  qloo: 'bg-tint-green text-ink',
  calc: 'border border-on-dark/60 text-on-dark',
  assumption: 'bg-tint-sand text-ink',
  sample: 'hatch border border-on-dark/50 text-on-dark',
};
const LABEL: Record<BadgeKind, string> = { qloo: 'QLOO', assumption: 'ASSUMPTION', calc: 'CALC', sample: 'SAMPLE' };
const TIP: Record<BadgeKind, string> = {
  qloo: 'Returned by Qloo for this segment.',
  assumption: 'Our guess, not a Qloo result. Change it and the numbers update.',
  calc: 'Arithmetic on the rows above.',
  sample: 'Synthetic demo value. Not from Qloo.',
};

export function Badge({ kind, children, onInk = false, className = '' }: { kind: BadgeKind; children?: React.ReactNode; onInk?: boolean; className?: string }) {
  return (
    <span
      title={TIP[kind]}
      className={`inline-block shrink-0 px-2 py-[5px] align-middle text-[10px] font-semibold uppercase leading-none tracking-[0.14em] ${onInk ? INK_STYLE[kind] : STYLE[kind]} ${className}`}
    >
      {children ?? LABEL[kind]}
    </span>
  );
}

export function BadgeLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
      <span className="inline-flex items-center gap-2"><Badge kind="qloo" /> returned by Qloo</span>
      <span className="inline-flex items-center gap-2"><Badge kind="calc" /> arithmetic on rows</span>
      <span className="inline-flex items-center gap-2"><Badge kind="assumption" /> our guess, editable</span>
      <span className="inline-flex items-center gap-2"><Badge kind="sample" /> synthetic demo value</span>
    </p>
  );
}
