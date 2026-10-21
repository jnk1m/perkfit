'use client';

import type { CandidateOverride } from '@/lib/api/types';
import type { Billing } from '@/lib/types';
import { usd } from '@/lib/ui/format';
import type { CandidateRowVm } from '@/lib/ui/viewModel';
import { Badge, BadgeLegend } from './Badge';
import { EditableNumber } from './EditableNumber';

type Edit = (id: string, patch: CandidateOverride) => void;

function cells(r: CandidateRowVm, onEdit: Edit, suffix: string) {
  const cur = (): CandidateOverride => ({ unitCost: r.unitCost, billing: r.billing, friction: r.friction });
  return {
    cost: <EditableNumber value={r.unitCost} kind="unitCost" label={`Unit cost for ${r.name}${suffix}`} format={(n) => usd(n)} className="w-20" onCommit={(v) => onEdit(r.id, { ...cur(), unitCost: v })} />,
    billing: (
      <select
        aria-label={`Billing for ${r.name}${suffix}`}
        value={r.billing}
        onChange={(e) => onEdit(r.id, { ...cur(), billing: e.target.value as Billing })}
        className="h-11 border-0 border-b border-dotted border-assume bg-transparent md:h-8"
      >
        <option value="per_use">per use</option>
        <option value="fixed">fixed fee</option>
      </select>
    ),
    friction: <EditableNumber value={r.friction} kind="friction" label={`Friction for ${r.name}${suffix}`} className="w-16" onCommit={(v) => onEdit(r.id, { ...cur(), friction: v })} />,
    match: r.match.kind === 'none' ? <span className="text-ink/60">not run yet</span> : r.match.kind === 'tier' ? <span>{r.match.text}</span> : <span className="font-semibold">{r.match.text}</span>,
  };
}

export function CandidateTable({ rows, onEdit, qlooBadge }: { rows: CandidateRowVm[]; onEdit: Edit; qlooBadge: 'qloo' | 'sample' }) {
  return (
    <div className="space-y-2">
      <BadgeLegend />
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Partner perk candidates with editable cost assumptions</caption>
        <thead>
          <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wide text-ink/80 align-bottom">
            <th scope="col" className="py-2">Perk</th>
            <th scope="col">Domain</th>
            <th scope="col" className="text-right">Unit cost, illustrative <Badge kind="assumption" /></th>
            <th scope="col">Billing <Badge kind="assumption" /></th>
            <th scope="col" className="text-right">Friction <Badge kind="assumption" /></th>
            <th scope="col">Qloo match <Badge kind={qlooBadge} /></th>
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
                <label className="block text-xs">Unit cost, illustrative{c.cost}</label>
                <label className="block text-xs">Billing{c.billing}</label>
                <label className="block text-xs">Friction{c.friction}</label>
              </div>
              <p className="mt-1 text-xs">Qloo match: {c.match}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
