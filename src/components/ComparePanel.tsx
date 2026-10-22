import type { ApiError } from '@/lib/types';
import type { CardVm, ViewModel } from '@/lib/ui/viewModel';

function CompareCard({ card, children }: { card?: CardVm; children?: React.ReactNode }) {
  return (
    <article className="border border-ink/40 bg-white/40 p-3 text-sm">
      <h3 className="font-display text-base font-semibold">{card?.title}</h3>
      {card && (
        <>
          <p className="mt-2 font-semibold">{card.headline}</p>
          <ul className="mt-2 space-y-0.5 text-xs tabular-nums">{card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {card.added.length > 0 && <p className="mt-2"><span className="font-semibold">Added:</span> {card.added.join(', ')}</p>}
          {card.dropped.length > 0 && <p><span className="font-semibold">Dropped:</span> {card.dropped.join(', ')}</p>}
          {card.note && <p className="mt-2 text-xs text-ink/75">{card.note}</p>}
        </>
      )}
      {children}
    </article>
  );
}

export function ComparePanel({
  cards, compare, running, llmRequested, canCompareWithB, onCompare,
}: {
  cards: ViewModel['cards'];
  compare: { phase: 'idle' | 'loading' | 'ready' | 'error'; error?: ApiError };
  running: boolean;
  llmRequested: boolean;
  canCompareWithB: boolean;
  onCompare: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <CompareCard card={cards.popularity} />

      {cards.llm ? (
        <CompareCard card={cards.llm} />
      ) : (
        <CompareCard>
          <h3 className="font-display text-base font-semibold">A general AI with no Qloo data</h3>
          <p className="mt-2 text-ink/80">
            {cards.llmState === 'failed' ? 'Baseline unavailable this run.' : !llmRequested ? 'Not requested for this run.' : running ? 'Waiting for the LLM baseline…' : 'No LLM baseline for this run.'}
          </p>
        </CompareCard>
      )}

      {cards.swap ? (
        <CompareCard card={cards.swap} />
      ) : (
        <CompareCard>
          <h3 className="font-display text-base font-semibold">Different segment</h3>
          {compare.phase === 'loading' && <p className="mt-2 text-ink/80" aria-live="polite">Comparing with the other example…</p>}
          {compare.phase === 'error' && (
            <div role="alert" className="mt-2">
              <p>{compare.error?.message ?? 'Comparison failed.'}</p>
              <button type="button" onClick={onCompare} className="mt-2 h-11 border border-ink px-3 md:h-8">Retry</button>
            </div>
          )}
          {compare.phase === 'idle' && canCompareWithB && (
            <button type="button" onClick={onCompare} className="mt-2 h-11 border border-ink px-3 md:h-8">Compare with Example B</button>
          )}
          {compare.phase === 'idle' && !canCompareWithB && <p className="mt-2 text-ink/80">Starts after a run on an example segment.</p>}
        </CompareCard>
      )}
    </div>
  );
}
