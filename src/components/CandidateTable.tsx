'use client';

import type { CandidateOverride } from '@/lib/api/types';
import type { Billing } from '@/lib/types';
import { usd } from '@/lib/ui/format';
import type { CandidateRowVm } from '@/lib/ui/viewModel';
import { TIER_DOTS } from '@/lib/ui/viewModel';
import { BadgeLegend } from './Badge';
import { EditableNumber } from './EditableNumber';
import { TierChip } from './TierChip';

type Edit = (id: string, patch: CandidateOverride) => void;

function cells(r: CandidateRowVm, onEdit: Edit) {
  const cur = (): CandidateOverride => ({ unitCost: r.unitCost, billing: r.billing, friction: r.friction });
  return {
    cost: <EditableNumber value={r.unitCost} kind="unitCost" label={`Cost per use for ${r.name}`} format={(n) => usd(n)} className="w-full" edited={r.edited.unitCost} onCommit={(v) => onEdit(r.id, { ...cur(), unitCost: v })} />,
    billing: (
      <select
        aria-label={`How billed for ${r.name}`}
        value={r.billing}
        onChange={(e) => onEdit(r.id, { ...cur(), billing: e.target.value as Billing })}
        className={`min-h-11 w-full min-w-0 border-b border-ink bg-transparent px-1 text-sm md:min-h-9${r.edited.billing ? ' border-dotted border-sienna' : ''}`}
      >
        <option value="per_use">per use</option>
        <option value="fixed">fixed fee</option>
      </select>
    ),
    friction: <EditableNumber value={r.friction} kind="friction" label={`Effort to redeem for ${r.name}`} className="w-full" edited={r.edited.friction} onCommit={(v) => onEdit(r.id, { ...cur(), friction: v })} />,
    match: r.match.kind === 'none'
      ? <span className="text-muted">not run yet</span>
      : r.match.kind === 'tier'
        ? <TierChip tier={r.match.tier} dots={TIER_DOTS[r.match.tier]} label={r.match.text} />
        : <span className="font-semibold">{r.match.text}</span>,
  };
}

/** Card rows, one layout at every width, so nothing overflows at 375px. */
export function CandidateTable({ rows, onEdit }: { rows: CandidateRowVm[]; onEdit: Edit; qlooBadge?: 'qloo' | 'sample' }) {
  return (
    <div className="space-y-3">
      <BadgeLegend />
      <ul aria-label="Partner perk candidates with editable cost assumptions" className="grid border-t border-ink md:grid-cols-2 md:gap-x-12">
        {rows.map((r) => {
          const c = cells(r, onEdit);
          return (
            <li key={r.id} className="border-b border-rule py-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 font-semibold">{r.name}</p>
                <p className="shrink-0 text-xs text-muted">{r.domainLabel}</p>
              </div>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                <label className="block min-w-0 text-xs text-muted">Cost per use{c.cost}</label>
                <label className="block min-w-0 text-xs text-muted">How billed{c.billing}</label>
                <label className="block min-w-0 text-xs text-muted">Effort to redeem{c.friction}</label>
              </div>
              <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">Taste match {c.match}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
