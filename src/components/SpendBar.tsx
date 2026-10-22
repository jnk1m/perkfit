import type { ViewModel } from '@/lib/ui/viewModel';
import { percent, usd } from '@/lib/ui/format';
import { Badge } from './Badge';

export function SpendBar({ spend }: { spend: ViewModel['spend'] }) {
  const label = `Spend ${usd(spend.used)} of ${usd(spend.budget)} (${percent(spend.ratio)})`;
  return (
    <div className="mt-6">
      <h3 className="mb-1 font-display text-lg font-semibold">Same budget, better fit</h3>
      <p className="mb-1 flex items-center gap-2 text-sm">
        <span className="tabular-nums">{label}</span>
        <Badge kind="calc" />
      </p>
      <div role="img" aria-label={`${label}, ${spend.parts.length} perks`} className="flex h-5 w-full border border-ink bg-white/50">
        {spend.parts.map((p, i) => (
          <div
            key={p.id}
            title={`${p.name}: ${usd(p.cost)}`}
            style={{ width: `${Math.min(100, (p.cost / spend.budget) * 100)}%` }}
            className={`h-full border-r border-paper ${i % 2 === 0 ? 'bg-ink' : 'bg-ink/55'}`}
          />
        ))}
      </div>
      <p className="mt-1 flex gap-4 text-xs text-ink/80">
        <span><span aria-hidden className="mr-1 inline-block size-2.5 bg-ink align-middle" />Bundle</span>
        <span><span aria-hidden className="mr-1 inline-block size-2.5 border border-ink bg-white/50 align-middle" />Unspent</span>
      </p>
    </div>
  );
}

export function ScenarioTable({ rows, showSaved }: { rows: ViewModel['scenarios']; showSaved: boolean }) {
  return (
    <table className="mt-4 w-full max-w-xl text-sm">
      <caption className="mb-1 flex items-center gap-2 text-left text-xs text-ink/80">
        Assumed usage share per case <Badge kind="assumption" />
      </caption>
      <thead>
        <tr className="border-b border-ink/40 text-left text-xs uppercase tracking-wide text-ink/75">
          <th scope="col" className="py-1">Usage case</th>
          <th scope="col" className="text-right">Perks</th>
          <th scope="col" className="text-right">Spend</th>
          {showSaved && <th scope="col" className="text-right">Would have gone to low-fit perks</th>}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={r.scenario} className={`border-b border-ink/15 ${r.scenario === 'base' ? 'font-semibold' : ''}`}>
            <th scope="row" className="py-1.5 text-left font-normal">{r.label}</th>
            <td className="text-right">{r.perks}</td>
            <td className="text-right">{r.spend}</td>
            {showSaved && <td className="text-right">{r.saved}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
