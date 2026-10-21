import type { ViewModel } from '@/lib/ui/viewModel';
import { Badge } from './Badge';

export function HoldoutCard({ rows }: { rows: ViewModel['holdout'] }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold">Our taste-fit tier is a hypothesis. Verify with a 10% holdout.</p>
      {rows.length === 0 ? (
        <p className="text-sm">No perks in the bundle, so there is nothing to test.</p>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Holdout test plan per perk</caption>
            <thead>
              <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wide text-ink/80">
                <th scope="col" className="py-2">Perk</th><th scope="col">Hypothesis <Badge kind="assumption" /></th><th scope="col">Holdout share</th>
                <th scope="col">Duration</th><th scope="col">Metric</th><th scope="col">Success rule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-ink/15 align-top">
                  <th scope="row" className="py-2 pr-2 text-left font-semibold">{r.name}</th>
                  <td className="pr-3">{r.hypothesis}</td><td>{r.share}</td><td>{r.duration}</td><td className="pr-3">{r.metric}</td><td>{r.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-ink/20 border-y border-ink/30 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <p className="font-semibold">{r.name}</p>
                <p>{r.hypothesis}</p>
                <p className="text-ink/80">{r.share} holdout · {r.duration} · {r.metric} · success if {r.rule}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
