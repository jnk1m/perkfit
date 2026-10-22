import type { ViewModel } from '@/lib/ui/viewModel';

export function HoldoutCard({ rows, intro }: { rows: ViewModel['holdout']; intro: string }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold">{intro}</p>
      {rows.length === 0 ? (
        <p className="text-sm">No perks in the bundle, so there is nothing to test.</p>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Holdout test plan per perk</caption>
            <thead>
              <tr className="border-b-2 border-ink text-left text-xs uppercase tracking-wide text-ink/80">
                <th scope="col" className="py-2">Perk</th><th scope="col">Question</th><th scope="col">Held back</th>
                <th scope="col">Measure</th><th scope="col">Pass if</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-ink/15 align-top">
                  <th scope="row" className="py-2 pr-2 text-left font-semibold">{r.name}</th>
                  <td className="pr-3">{r.question}</td><td className="pr-3">{r.share}</td><td className="pr-3">{r.metric}</td><td>{r.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-ink/20 border-y border-ink/30 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">{r.name}</summary>
                  <p>{r.question}</p>
                  <p className="mt-1 text-ink/80">Held back: {r.share} · Measure: {r.metric} · Pass if: {r.rule}</p>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
