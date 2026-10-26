import type { SentenceVm } from '@/lib/ui/viewModel';
import type { WhyRowVm } from '@/lib/ui/viewModel';
import { Badge } from './Badge';
import { SafeUseNote } from './SafeUseNote';

const EV = 'grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-x-3.5 border-b border-ink/25 py-2 text-[15px] md:grid-cols-[104px_minmax(0,1fr)_auto]';

/** Sand evidence panel: the model's sentence on the left, one row of evidence per badge on the right. */
export function WhyRow({ rows, sentence, lead = [] }: { rows: WhyRowVm[]; sentence: SentenceVm; lead?: { label: string; value: string }[] }) {
  return (
    <div className="grid gap-6 bg-sand px-[18px] py-6 text-ink md:grid-cols-[1fr_1.05fr] md:gap-14 md:px-10 md:py-9">
      <div>
        {sentence.state === 'verified' && (
          <>
            <p className="font-display text-[22px] italic leading-[1.25] md:text-[30px]">{sentence.text}</p>
            <p className="mt-4 text-[13px] text-muted">AI explanation, checked against these rows</p>
          </>
        )}
        {sentence.state === 'discarded' && <p className="text-[15px] text-muted">No verified explanation. See rows.</p>}
        {sentence.state === 'pending' && <p className="text-[15px] text-muted">AI explanation: checking…</p>}
        <SafeUseNote variant="why" />
      </div>
      <ul className="border-t border-ink/25">
        {lead.map((l) => (
          <li key={l.label} className={EV}>
            <span aria-hidden />
            <span>{l.label}</span>
            <b className="text-right font-semibold tabular-nums">{l.value}</b>
          </li>
        ))}
        {rows.map((r) => (
          <li key={r.key} className={EV}>
            <span><Badge kind={r.badge} className="w-full text-center" /></span>
            <span>
              {r.field}
              {r.note && <span className="block text-[13px] text-muted">{r.note}</span>}
            </span>
            <b className="text-right font-semibold tabular-nums">{r.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
