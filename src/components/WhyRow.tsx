import type { SentenceVm, WhyRowVm } from '@/lib/ui/viewModel';
import { Badge } from './Badge';
import { SafeUseNote } from './SafeUseNote';

export function WhyRow({ rows, sentence }: { rows: WhyRowVm[]; sentence: SentenceVm }) {
  return (
    <div className="border-l-2 border-ink/40 bg-white/40 p-3">
      <ul className="divide-y divide-ink/10 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-x-3 py-1">
            <span><Badge kind={r.badge} /></span>
            <span>
              {r.field}
              {r.note && <span className="block text-xs text-ink/75">{r.note}</span>}
            </span>
            <span className="text-right tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
      {sentence.state === 'verified' && (
        <p className="mt-3 text-sm">
          <span className="block text-xs font-semibold text-ink/80">AI explanation, checked against these rows</span>
          {sentence.text}
        </p>
      )}
      {sentence.state === 'discarded' && <p className="mt-3 text-sm text-ink/80">No verified explanation. See rows.</p>}
      {sentence.state === 'pending' && <p className="mt-3 text-sm text-ink/80">AI explanation: checking…</p>}
      <SafeUseNote variant="why" />
    </div>
  );
}
