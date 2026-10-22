'use client';

import type { CandidateOverride } from '@/lib/api/types';
import type { Billing } from '@/lib/types';
import { usd } from '@/lib/ui/format';
import type { CandidateRowVm } from '@/lib/ui/viewModel';
import { TIER_DOTS } from '@/lib/ui/viewModel';
import { BadgeLegend } from './Badge';
import { EditableNumber } from './EditableNumber';

type Edit = (id: string, patch: CandidateOverride) => void;

function cells(r: CandidateRowVm, onEdit: Edit, suffix: string) {
  const cur = (): CandidateOverride => ({ unitCost: r.unitCost, billing: r.billing, friction: r.friction });
  return {
    cost: <EditableNumber value={r.unitCost} kind="unitCost" label={`Cost per use for ${r.name}${suffix}`} format={(n) => usd(n)} className="w-20" edited={r.edited.unitCost} onCommit={(v) => onEdit(r.id, { ...cur(), unitCost: v })} />,
    billing: (
      <select
        aria-label={`How billed for ${r.name}${suffix}`}
        value={r.billing}
        onChange={(e) => onEdit(r.id, { ...cur(), billing: e.target.value as Billing })}
        className={`h-11 border-0 border-b border-dotted border-assume bg-transparent md:h-8${r.edited.billing ? ' ring-1 ring-assume' : ''}`}
      >
        <option value="per_use">per use</option>
        <option value="fixed">fixed fee</option>
      </select>
    ),
    friction: <EditableNumber value={r.friction} kind="friction" label={`Effort to redeem for ${r.name}${suffix}`} className="w-16" edited={r.edited.friction} onCommit={(v) => onEdit(r.id, { ...cur(), friction: v })} />,
    match: r.match.kind === 'none' ? <span className="text-ink/60">not run yet</span> : r.match.kind === 'tier' ? <span><span aria-hidden className="mr-1">{TIER_DOTS[r.match.tier]}</span>{r.match.text.replace(/ \((.*)\)$/, ' · $1')}</span> : <span className="font-semibold">{r.match.text}</span>,
  };
}

export function CandidateTable({ rows, onEdit }: { rows: CandidateRowVm[]; onEdit: Edit; qlooBadge?: 'qloo' | 'sample' }) {
  return (
    <div className="space-y-2">
      <BadgeLegend />
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Partner perk candidates with editable cost assumptions</caption>
        <thead>
          <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wide text-ink/80 align-bottom">
            <th scope="col" className="py-2">Perk</th>
            <th scope="col">Category</th>
            <th scope="col" className="text-right">Cost per use</th>
            <th scope="col">How billed</th>
            <th scope="col" className="text-right">Effort to redeem</th>
            <th scope="col">Taste match</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const c = cells(r, onEdit, '');
            return (
              <tr key={r.id} className="border-b border-ink/15">
                <th scope="row" className="py-1 text-left font-normal">{r.name}</th>
                <td>{r.domainLabel}</td>
                <td className="text-right">{c.cost}</td>
                <td>{c.billing}</td>
                <td className="text-right">{c.friction}</td>
                <td>{c.match}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-ink/20 border-y border-ink/30 md:hidden">
        {rows.map((r) => {
          const c = cells(r, onEdit, ' (card)');
          return (
            <li key={r.id} className="py-2 text-sm">
              <p className="font-semibold">{r.name} <span className="font-normal text-ink/75">· {r.domainLabel}</span></p>
              <div className="mt-1 grid grid-cols-3 gap-2">
                <label className="block text-xs">Cost per use{c.cost}</label>
                <label className="block text-xs">How billed{c.billing}</label>
                <label className="block text-xs">Effort to redeem{c.friction}</label>
              </div>
              <p className="mt-1 text-xs">Taste match: {c.match}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
