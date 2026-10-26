import type { Domain } from '@/lib/types';
import type { ViewModel } from '@/lib/ui/viewModel';
import { percent, usd } from '@/lib/ui/format';
import { Badge } from './Badge';

/** Budget meter tints on the ink field: TV = sand tint, Book = green tint, Place = sand, Brand = paper-muted. */
const DOMAIN_FILL: Record<Domain, string> = { tv_show: 'bg-tint-sand', book: 'bg-tint-green', place: 'bg-sand', brand: 'bg-on-dark-muted' };
const DOMAIN_NAME: Record<Domain, string> = { tv_show: 'TV show', book: 'Book', place: 'Place', brand: 'Brand' };

/**
 * On the ink result field. `domains` maps perk id to its domain so each block gets its domain tint;
 * without it every block is green.
 */
export function SpendBar({ spend, domains }: { spend: ViewModel['spend']; domains?: Record<string, Domain> }) {
  const aria = `Spend ${usd(spend.used)} of ${usd(spend.budget)} (${percent(spend.ratio)})`;
  const left = Math.max(0, spend.budget - spend.used);
  const shown = [...new Set(spend.parts.map((p) => domains?.[p.id]).filter((d): d is Domain => d !== undefined))];
  return (
    <div className="mt-8 md:mt-11">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-on-dark-muted tabular-nums">
        <span className="flex items-center gap-2">
          {usd(spend.used)} of {usd(spend.budget)} used
          <Badge kind="calc" onInk />
        </span>
        <span>{usd(left)} left</span>
      </div>
      <div role="img" aria-label={`${aria}, ${spend.parts.length} perks`} className="flex h-[34px] gap-[3px] bg-ink-2">
        {spend.parts.map((p) => (
          <div
            key={p.id}
            title={`${p.name}: ${usd(p.cost)}`}
            style={{ width: `${Math.min(100, (p.cost / spend.budget) * 100)}%` }}
            className={`h-full ${domains?.[p.id] ? DOMAIN_FILL[domains[p.id]] : 'bg-tint-green'}`}
          />
        ))}
      </div>
      <p className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-on-dark-muted">
        {shown.length > 0
          ? shown.map((d) => <span key={d}><span aria-hidden className={`mr-1.5 inline-block size-2.5 align-[-1px] ${DOMAIN_FILL[d]}`} />{DOMAIN_NAME[d]}</span>)
          : <span><span aria-hidden className="mr-1.5 inline-block size-2.5 align-[-1px] bg-tint-green" />Bundle (one block per perk)</span>}
        <span><span aria-hidden className="mr-1.5 inline-block size-2.5 align-[-1px] bg-ink-2 ring-1 ring-on-dark/30" />Unspent</span>
      </p>
    </div>
  );
}

/** Usage-case table, on the ink field inside the folded "Usage cases" block. */
export function ScenarioTable({ rows, showSaved }: { rows: ViewModel['scenarios']; showSaved: boolean }) {
  return (
    <table className="mt-4 w-full max-w-xl text-sm text-on-dark">
      <caption className="mb-2 flex items-center gap-2 text-left text-[13px] text-on-dark-muted">
        Assumed usage share per case <Badge kind="assumption" onInk />
      </caption>
      <thead>
        <tr className="border-b border-on-dark/30 text-left text-[11px] uppercase tracking-[0.12em] text-on-dark-muted">
          <th scope="col" className="py-1.5 font-semibold">Usage case</th>
          <th scope="col" className="text-right font-semibold">Perks</th>
          <th scope="col" className="text-right font-semibold">Spend</th>
          {showSaved && <th scope="col" className="text-right font-semibold">Would have gone to low-fit perks</th>}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={r.scenario} className={`border-b border-on-dark/15 ${r.scenario === 'base' ? 'font-semibold' : ''}`}>
            <th scope="row" className="py-2 text-left font-normal">{r.label}</th>
            <td className="text-right">{r.perks}</td>
            <td className="text-right">{r.spend}</td>
            {showSaved && <td className="text-right">{r.saved}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
