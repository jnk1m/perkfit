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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="text-sm">
          <p className="mb-1 flex items-center gap-2">Monthly budget <Badge kind="assumption" /></p>
          <EditableNumber value={budget} kind="budget" label="Monthly budget in dollars" format={usd} className="w-28" onCommit={onBudget} />
        </div>
        <div className="text-sm">
          <p className="mb-1 flex items-center gap-2">Members <Badge kind="assumption" /></p>
          <EditableNumber value={members} kind="members" label="Number of members" format={(n) => n.toLocaleString('en-US')} className="w-28" onCommit={onMembers} />
        </div>
      </div>

      <fieldset className="text-sm">
        <legend className="mb-1 flex items-center gap-2">Assumed share of members using the perk, by taste fit <Badge kind="assumption" /></legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(['high', 'mid', 'low'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2">
              {TIER_NAME[t]}
              <EditableNumber value={usage[t]} kind="usage" label={`Assumed usage share, ${TIER_NAME[t]} taste fit`} className="w-16" onCommit={(v) => onUsage(t, v)} />
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink/75">Per-use ranking does not depend on usage assumptions; only fixed-fee perks are sensitive to them.</p>
      </fieldset>

      <fieldset className="text-sm">
        <legend className="mb-1 flex items-center gap-2">Domain weights (0 to 2) <Badge kind="assumption" /></legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(Object.keys(DOMAIN_NAME) as Domain[]).map((d) => (
            <label key={d} className="flex items-center gap-2">
              {DOMAIN_NAME[d]}
              <EditableNumber value={weights[d]} kind="weight" label={`Weight for ${DOMAIN_NAME[d]}`} className="w-16" onCommit={(v) => onWeight(d, v)} />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeLlm} onChange={(e) => onIncludeLlm(e.target.checked)} className="size-5" />
        Also ask an LLM alone for a baseline bundle
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRun}
          disabled={running || !canRun}
          className="h-12 border-2 border-ink bg-ink px-5 font-semibold text-paper disabled:opacity-40"
        >
          {running ? 'Running…' : runLabel}
        </button>
        {blockedReason && <p role="alert" className="text-sm text-assume">{blockedReason}</p>}
      </div>
    </div>
  );
}
