import type { BundleRowVm } from '@/lib/ui/viewModel';
import { WhyRow } from './WhyRow';

function WhyButton({ row, open, onToggle, prefix }: { row: BundleRowVm; open: boolean; onToggle: (id: string) => void; prefix: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`why-${prefix}-${row.id}`}
      aria-label={`Why ${row.name}?`}
      onClick={() => onToggle(row.id)}
      className="h-11 border border-ink px-3 text-sm md:h-8"
    >
      Why?
    </button>
  );
}

function whyLead(r: BundleRowVm) {
  return [{ label: 'Holds up', value: r.stable }];
}

function Contrast({ row }: { row: BundleRowVm }) {
  return (
    <>
      <span className="text-ink/75">{row.popularityRank ?? '—'}</span>
      <span aria-hidden className="mx-1">→</span>
      <span className="sr-only"> to taste match </span>
      <span className="font-semibold"><span aria-hidden className="mr-1">{row.tierDots}</span>{row.tierLabel}</span>
    </>
  );
}

export function BundleTable({ rows, openId, onToggle }: { rows: BundleRowVm[]; openId: string | null; onToggle: (id: string) => void; qlooBadge?: 'qloo' | 'sample' }) {
  if (rows.length === 0) return <p className="text-sm">No perk fits this budget with the data we have.</p>;
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">Perks in the best bundle for the base scenario</caption>
        <thead>
          <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wide text-ink/80 align-bottom">
            <th scope="col" className="py-2">Perk</th>
            <th scope="col">Popular → Taste match</th>
            <th scope="col" className="text-right">Est. cost / month</th>
            <th scope="col" className="text-right"><span className="sr-only">Why</span></th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <BundleRows key={r.id} row={r} open={openId === r.id} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-ink/20 border-y border-ink/30 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{r.name}</p>
                <p className="text-xs text-ink/75">{r.domain}</p>
                <p className="mt-1 text-sm tabular-nums"><Contrast row={r} /></p>
                {r.reason && <p className="text-xs text-ink/75">{r.reason}</p>}
                <p className="text-sm tabular-nums">{r.cost}/month <span className="text-xs text-ink/75">({r.costRange})</span></p>
              </div>
              <WhyButton row={r} open={openId === r.id} onToggle={onToggle} prefix="m" />
            </div>
            {openId === r.id && (
              <div id={`why-m-${r.id}`} className="mt-2"><WhyRow rows={r.why} sentence={r.sentence} lead={whyLead(r)} /></div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function BundleRows({ row, open, onToggle }: { row: BundleRowVm; open: boolean; onToggle: (id: string) => void }) {
  return (
    <>
      <tr className="border-b border-ink/15 align-top">
        <th scope="row" className="py-2 text-left font-semibold">
          {row.name}
          <span className="block text-xs font-normal text-ink/75">{row.domain}</span>
          {row.reason && <span className="block text-xs font-normal text-ink/75">{row.reason}</span>}
        </th>
        <td><Contrast row={row} /></td>
        <td className="text-right">{row.cost}<span className="block text-xs text-ink/75">{row.costRange}</span></td>
        <td className="text-right"><WhyButton row={row} open={open} onToggle={onToggle} prefix="d" /></td>
      </tr>
      {open && (
        <tr id={`why-d-${row.id}`} className="border-b border-ink/15">
          <td colSpan={4} className="pb-3"><WhyRow rows={row.why} sentence={row.sentence} lead={whyLead(row)} /></td>
        </tr>
      )}
    </>
  );
}
