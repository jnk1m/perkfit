'use client';

import type { Domain, FitTier } from '@/lib/types';
import { usd } from '@/lib/ui/format';
import { Badge } from './Badge';
import { EditableNumber } from './EditableNumber';

const DOMAIN_NAME: Record<Domain, string> = { place: 'Places', tv_show: 'TV shows', brand: 'Brands', book: 'Books' };
const TIER_NAME: Record<FitTier, string> = { high: 'High', mid: 'Mid', low: 'Low' };

export function BudgetPanel({
  budget, members, usage, weights, includeLlm, running, canRun, blockedReason, runLabel,
  onBudget, onMembers, onUsage, onWeight, onIncludeLlm, onRun,
}: {
  budget: number; members: number; usage: Record<FitTier, number>; weights: Record<Domain, number>; includeLlm: boolean;
  running: boolean; canRun: boolean; blockedReason: string | null; runLabel: string;
  onBudget: (v: number) => void; onMembers: (v: number) => void; onUsage: (t: FitTier, v: number) => void; onWeight: (d: Domain, v: number) => void;
  onIncludeLlm: (v: boolean) => void; onRun: () => void;
}) {
  const row = 'flex items-center justify-between gap-4';
  return (
    <div className="space-y-4 text-[15px]">
      <div className={row}>
        <span className="flex flex-wrap items-center gap-x-2">Monthly budget <Badge kind="assumption" /></span>
        <EditableNumber value={budget} kind="budget" label="Monthly budget in dollars" format={usd} className="w-32 font-semibold" onCommit={onBudget} />
      </div>
      <div className={row}>
        <span className="flex flex-wrap items-center gap-x-2">Members <Badge kind="assumption" /></span>
        <EditableNumber value={members} kind="members" label="Number of members" format={(n) => n.toLocaleString('en-US')} className="w-32 font-semibold" onCommit={onMembers} />
      </div>

      <fieldset>
        <legend className="mb-2 flex flex-wrap items-center gap-x-2">Usage by taste match <Badge kind="assumption" /></legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(['high', 'mid', 'low'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2 text-muted">
              {TIER_NAME[t]}
              <EditableNumber value={usage[t]} kind="usage" label={`Assumed usage share, ${TIER_NAME[t]} taste fit`} className="w-14 font-semibold text-ink" onCommit={(v) => onUsage(t, v)} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">Assumed share of members using the perk. Per-use ranking does not depend on usage assumptions; only fixed-fee perks are sensitive to them.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 flex flex-wrap items-center gap-x-2">Domain weights (0 to 2) <Badge kind="assumption" /></legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(Object.keys(DOMAIN_NAME) as Domain[]).map((d) => (
            <label key={d} className="flex items-center gap-2 text-muted">
              {DOMAIN_NAME[d]}
              <EditableNumber value={weights[d]} kind="weight" label={`Weight for ${DOMAIN_NAME[d]}`} className="w-12 font-semibold text-ink" onCommit={(v) => onWeight(d, v)} />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeLlm} onChange={(e) => onIncludeLlm(e.target.checked)} className="size-5 shrink-0 accent-ink" />
        Also ask an LLM alone for a baseline bundle
      </label>

      <div className="space-y-2 pt-1">
        <button
          type="button"
          onClick={onRun}
          disabled={running || !canRun}
          className="min-h-12 bg-ink px-[26px] py-3.5 text-sm font-semibold tracking-[0.04em] text-paper transition-colors hover:bg-bottle focus-visible:outline-3 focus-visible:outline-sienna active:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink"
        >
          {running ? 'Running…' : runLabel}
        </button>
        {blockedReason && <p role="alert" className="text-sm text-sienna">{blockedReason}</p>}
      </div>
    </div>
  );
}
