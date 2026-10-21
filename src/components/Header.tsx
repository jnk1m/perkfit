import type { RunMeta } from '@/lib/types';
import { metaLine } from '@/lib/ui/viewModel';
import { Badge } from './Badge';

export function Header({
  mode, liveAvailable, meta, onMode, summary,
}: {
  mode: 'live' | 'sample';
  liveAvailable: boolean;
  meta: RunMeta | null;
  onMode: (m: 'live' | 'sample') => void;
  summary: { text: string; spend: string } | null;
}) {
  const btn = (m: 'live' | 'sample', label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === m}
      disabled={disabled}
      title={disabled ? 'No Qloo key on this deployment' : undefined}
      onClick={() => onMode(m)}
      className={`h-11 px-3 text-xs font-semibold tracking-wider md:h-8 ${mode === m ? 'bg-ink text-paper' : 'text-ink'} disabled:opacity-40`}
    >
      {label}
    </button>
  );
  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <h1 className="font-display text-2xl font-semibold">PerkFit</h1>
        <div role="group" aria-label="Data mode" className="flex border border-ink">
          {btn('live', 'LIVE', !liveAvailable)}
          {btn('sample', 'SAMPLE')}
        </div>
        {mode === 'sample' && <Badge kind="sample" />}
        <p className="min-w-0 flex-1 text-xs text-ink/80 tabular-nums">
          {meta ? metaLine(meta) : 'No run yet'}
          {meta?.quota && <span className="ml-3 font-semibold">Live runs left: {meta.quota.liveRunsLeft}</span>}
        </p>
      </div>
      {summary && (
        <div className="mx-auto flex max-w-6xl items-baseline gap-3 border-t border-ink/20 px-4 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate font-display font-semibold">{summary.text}</span>
          <span className="shrink-0 tabular-nums text-ink/80">{summary.spend}</span>
        </div>
      )}
    </header>
  );
}
