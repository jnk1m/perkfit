import type { BundleRowVm } from '@/lib/ui/viewModel';
import { TierChip } from './TierChip';
import { WhyRow } from './WhyRow';

function WhyButton({ row, open, onToggle }: { row: BundleRowVm; open: boolean; onToggle: (id: string) => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`why-${row.id}`}
      aria-label={`Why ${row.name}?`}
      onClick={() => onToggle(row.id)}
      className={`h-11 border border-ink px-4 text-xs font-semibold tracking-[0.08em] transition-colors hover:bg-ink hover:text-paper active:bg-ink/85 active:text-paper md:h-10 ${open ? 'bg-ink text-paper' : 'bg-transparent text-ink'}`}
    >
      Why {open ? '−' : '+'}
    </button>
  );
}

function whyLead(r: BundleRowVm) {
  return [{ label: 'Holds up', value: r.stable }];
}

export function BundleTable({ rows, openId, onToggle }: { rows: BundleRowVm[]; openId: string | null; onToggle: (id: string) => void; qlooBadge?: 'qloo' | 'sample' }) {
  if (rows.length === 0) return <p className="text-[15px]">No perk fits this budget with the data we have.</p>;
  return (
    <ul aria-label="Perks in the best bundle for the base scenario">
      {rows.map((r, i) => {
        const open = openId === r.id;
        return (
          <li key={r.id} className="border-b border-ink">
            <div className="grid grid-cols-[48px_1fr] items-center gap-x-3.5 gap-y-2.5 py-6 md:grid-cols-[84px_minmax(0,1fr)_300px_150px_110px] md:gap-x-6">
              <p aria-hidden className="font-display text-[40px] leading-none text-sienna md:text-[64px]">{i + 1}</p>
              <div className="min-w-0">
                <p className="font-display text-[28px] leading-[1.05] md:text-[38px]">{r.name}</p>
                <p className="label mt-2.5 font-semibold text-muted">{r.domain}</p>
              </div>
              <div className="col-start-2 md:col-start-auto">
                <TierChip tier={r.tier} dots={r.tierDots} label={r.tierLabel} />
                <p className="mt-1.5 text-sm text-muted">{r.popularityRank ?? 'No popularity signal'}</p>
                {r.reason && <p className="mt-0.5 text-[13px] font-semibold text-bottle">{r.reason}</p>}
              </div>
              <p className="col-start-2 font-display text-[28px] leading-none tabular-nums md:col-start-auto md:text-right">
                {r.cost}/month
                <span className="mt-1.5 block font-sans text-xs font-medium text-muted">{r.costRange}</span>
              </p>
              <div className="col-start-2 md:col-start-auto md:justify-self-end"><WhyButton row={r} open={open} onToggle={onToggle} /></div>
            </div>
            {open && (
              <div id={`why-${r.id}`} className="transition-opacity duration-[180ms] starting:opacity-0">
                <WhyRow rows={r.why} sentence={r.sentence} lead={whyLead(r)} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
