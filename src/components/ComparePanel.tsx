import type { ApiError } from '@/lib/types';
import type { CardVm, ViewModel } from '@/lib/ui/viewModel';

const CARD = 'py-8 md:py-0 md:px-9 first:md:pl-0 last:md:pr-0 md:border-l md:border-on-dark/30 first:md:border-l-0 border-t border-on-dark/30 first:border-t-0';
const TITLE = 'label font-semibold text-tint-sand';
const BTN = 'mt-3 h-11 border border-on-dark/60 bg-transparent px-4 text-[13px] font-semibold text-on-dark transition-colors hover:bg-on-dark hover:text-ink active:bg-on-dark/80 active:text-ink md:h-10';

/** "4 of 5 perks change; ..." becomes a big "4 of 5" and the rest as the label under it. */
function splitHeadline(h: string): { big: string; rest: string } | null {
  const m = /^(?:Picks )?(\d+ of (?:the same )?\d+)\s*(.*)$/.exec(h);
  if (!m) return null;
  return { big: m[1].replace('the same ', ''), rest: m[2] };
}

function CompareCard({ card, children }: { card?: CardVm; children?: React.ReactNode }) {
  const split = card ? splitHeadline(card.headline) : null;
  return (
    <article className={CARD}>
      {card && <h3 className={TITLE}>{card.title}</h3>}
      {card && (
        <>
          {split ? (
            <p className="mt-3.5 font-display text-[64px] leading-none tabular-nums md:text-[96px]">
              {split.big}
              <span className="mt-2.5 block font-sans text-sm font-medium text-on-dark-muted">{split.rest}</span>
            </p>
          ) : (
            <p className="mt-3.5 font-display text-[28px] leading-[1.15]">{card.headline}</p>
          )}
          <ul className="mt-4 max-w-80 space-y-1 text-[15px] text-on-dark/90 tabular-nums">{card.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {card.added.length > 0 && <p className="mt-3 max-w-80 text-[15px] text-on-dark/90"><span className="font-semibold">Added:</span> {card.added.join(', ')}</p>}
          {card.dropped.length > 0 && <p className="max-w-80 text-[15px] text-on-dark/90"><span className="font-semibold">Dropped:</span> {card.dropped.join(', ')}</p>}
          {card.note && <p className="mt-3 max-w-80 text-[13px] text-on-dark-muted">{card.note}</p>}
        </>
      )}
      {children}
    </article>
  );
}

/** Three columns on the bottle field. Colours are on-dark tokens, so the parent supplies `field-bottle`. */
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
    <div className="grid text-on-dark md:grid-cols-3">
      <CompareCard card={cards.popularity} />

      {cards.llm ? (
        <CompareCard card={cards.llm} />
      ) : (
        <CompareCard>
          <h3 className={TITLE}>A general AI with no Qloo data</h3>
          <p className="mt-3.5 font-display text-[28px] leading-[1.15]">Generic</p>
          <p className="mt-3 max-w-80 text-[15px] text-on-dark-muted">
            {cards.llmState === 'failed' ? 'Baseline unavailable this run.' : !llmRequested ? 'Not requested for this run.' : running ? 'Waiting for the LLM baseline…' : 'No LLM baseline for this run.'}
          </p>
        </CompareCard>
      )}

      {cards.swap ? (
        <CompareCard card={cards.swap} />
      ) : (
        <CompareCard>
          <h3 className={TITLE}>Different segment</h3>
          {compare.phase === 'loading' && <p className="mt-3.5 text-[15px] text-on-dark-muted" aria-live="polite">Comparing with the other example…</p>}
          {compare.phase === 'error' && (
            <div role="alert" className="mt-3.5 text-[15px]">
              <p>{compare.error?.message ?? 'Comparison failed.'}</p>
              <button type="button" onClick={onCompare} className={BTN}>Retry</button>
            </div>
          )}
          {compare.phase === 'idle' && canCompareWithB && (
            <button type="button" onClick={onCompare} className={BTN}>Compare with Example B</button>
          )}
          {compare.phase === 'idle' && !canCompareWithB && <p className="mt-3.5 max-w-80 text-[15px] text-on-dark-muted">Starts after a run on an example segment.</p>}
        </CompareCard>
      )}
    </div>
  );
}
