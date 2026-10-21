import type { BadgeKind } from '@/lib/ui/viewModel';

const STYLE: Record<BadgeKind, string> = {
  qloo: 'bg-qloo text-white border border-qloo',
  assumption: 'border border-dashed border-assume text-assume',
  calc: 'border border-ink text-ink',
  sample: 'hatch border border-ink/50 text-ink',
};
const LABEL: Record<BadgeKind, string> = { qloo: 'QLOO', assumption: 'ASSUMPTION', calc: 'CALC', sample: 'SAMPLE' };
const TIP: Record<BadgeKind, string> = {
  qloo: 'Returned by Qloo for this segment.',
  assumption: 'Our guess, not a Qloo result. Change it and the numbers update.',
  calc: 'Arithmetic on the rows above.',
  sample: 'Synthetic demo value. Not from Qloo.',
};

export function Badge({ kind, children }: { kind: BadgeKind; children?: React.ReactNode }) {
  return (
    <span
      title={TIP[kind]}
      className={`inline-block shrink-0 rounded-sm px-1.5 py-px align-middle text-[10px] font-semibold leading-4 tracking-wider ${STYLE[kind]}`}
    >
      {children ?? LABEL[kind]}
    </span>
  );
}

export function BadgeLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/75">
      <span><Badge kind="qloo" /> returned by Qloo</span>
      <span><Badge kind="assumption" /> our guess, editable</span>
      <span><Badge kind="calc" /> arithmetic on rows</span>
      <span><Badge kind="sample" /> synthetic demo value</span>
    </p>
  );
}
