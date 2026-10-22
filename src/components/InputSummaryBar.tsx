import { usd } from '@/lib/ui/format';

/** One-line stand-in for the three input sections once a result is on screen. */
export function InputSummaryBar({
  segmentName, perks, budget, members, onEdit,
}: { segmentName: string; perks: number; budget: number; members: number; onEdit: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-ink bg-white/50 px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 tabular-nums">
        {segmentName} · {perks} perks · {usd(budget)} · {members.toLocaleString('en-US')} members
      </p>
      <button type="button" onClick={onEdit} className="h-11 border border-ink px-3 text-sm font-semibold md:h-8">Edit inputs</button>
    </div>
  );
}
