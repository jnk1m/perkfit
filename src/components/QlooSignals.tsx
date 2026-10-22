import type { RunMeta } from '@/lib/types';

const SOURCE: Record<RunMeta['dataSource'], string> = { live: 'live', cache: 'cached from live', sample: 'sample' };

export function QlooSignals({ chips, perks, categories, meta }: { chips: number; perks: number; categories: number; meta: RunMeta | null }) {
  if (!meta) return null;
  return (
    <p data-testid="qloo-signals" className="text-sm text-ink/85">
      {chips} interest {chips === 1 ? 'chip' : 'chips'} · {perks} perks in {categories} categories · {meta.qlooCalls} Qloo {meta.qlooCalls === 1 ? 'call' : 'calls'} ({SOURCE[meta.dataSource]})
    </p>
  );
}
