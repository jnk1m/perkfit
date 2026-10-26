import type { ViewModel } from '@/lib/ui/viewModel';

const GRID = 'grid gap-x-4 gap-y-1 md:grid-cols-[56px_1fr_1.5fr_1fr_1fr_1.1fr]';
const HEAD = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-sienna';

function Cell({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className={`${HEAD} md:sr-only`}>{label}</dt>
      <dd className="text-[15px]">{children}</dd>
    </div>
  );
}

/** One numbered row per perk in the bundle: what to hide, from whom, how long, and what counts as a pass. */
export function HoldoutCard({ rows, intro }: { rows: ViewModel['holdout']; intro: string }) {
  return (
    <div>
      <p className="mb-4 text-[15px] text-muted">{intro}</p>
      {rows.length === 0 ? (
        <p className="text-[15px]">No perks in the bundle, so there is nothing to test.</p>
      ) : (
        <>
          <div aria-hidden className={`${GRID} hidden border-b border-ink pb-2.5 md:grid`}>
            <span /><span className={HEAD}>Perk</span><span className={HEAD}>What you check</span><span className={HEAD}>Held back</span><span className={HEAD}>Measure</span><span className={HEAD}>Pass if</span>
          </div>
          <ol aria-label="Holdout test plan per perk">
            {rows.map((r, i) => (
              <li key={r.id}>
                <dl className={`${GRID} border-b border-ink/30 py-3.5`}>
                  <dt className="sr-only">Step</dt>
                  <dd aria-hidden className="font-display text-[26px] leading-none text-sienna">{i + 1}</dd>
                  <Cell label="Perk" className="font-display text-[22px] leading-tight md:text-[20px]"><span className="font-display">{r.name}</span></Cell>
                  <Cell label="What you check">{r.question}</Cell>
                  <Cell label="Held back">{r.share} for {r.duration}</Cell>
                  <Cell label="Measure">{r.metric}</Cell>
                  <Cell label="Pass if">{r.rule}</Cell>
                </dl>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
