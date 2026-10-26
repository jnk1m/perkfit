import type { RunMeta } from '@/lib/types';

const SOURCE: Record<RunMeta['dataSource'], string> = { live: 'live', cache: 'cached from live', sample: 'sample' };

/** Sits on the ink result field. */
export function QlooSignals({ chips, perks, categories, meta }: { chips: number; perks: number; categories: number; meta: RunMeta | null }) {
  if (!meta) return null;
  return (
    <p data-testid="qloo-signals" className="mt-3 text-[13px] text-on-dark-muted">
      {chips} interest {chips === 1 ? 'chip' : 'chips'}, {perks} perks in {categories} categories, {meta.qlooCalls} Qloo {meta.qlooCalls === 1 ? 'call' : 'calls'} ({SOURCE[meta.dataSource]})
    </p>
  );
}
