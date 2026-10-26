import type { RunMeta } from '@/lib/types';
import { metaLine } from '@/lib/ui/viewModel';
import { Badge } from './Badge';
import { WRAP } from './Section';

/** Masthead: 10px ink band, running head, the wordmark, the LIVE/SAMPLE toggle and a two-line status. */
export function Header({
  mode, liveAvailable, meta, onMode,
}: {
  mode: 'live' | 'sample';
  liveAvailable: boolean;
  meta: RunMeta | null;
  onMode: (m: 'live' | 'sample') => void;
}) {
  const btn = (m: 'live' | 'sample', label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={mode === m}
      disabled={disabled}
      title={disabled ? 'No Qloo key on this deployment' : undefined}
      onClick={() => onMode(m)}
      className={`label min-h-11 border-b-2 pb-1 font-semibold transition-colors md:min-h-0 ${mode === m ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
  const parts = meta ? metaLine(meta).split(' · ') : [];
  return (
    <header className="border-t-[10px] border-ink">
      <div className={`${WRAP} pb-8 pt-7`}>
        <div className="label flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-ink pb-5 font-semibold text-muted">
          <span>PerkFit &middot; Perks chosen by audience taste</span>
          <span>Qloo Agentic Hackathon</span>
        </div>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-display text-[64px] leading-[0.9] tracking-[-0.02em] sm:text-[104px] lg:text-[148px]">
            Perk<i className="text-wine">Fit</i>
          </h1>
          <div className="sm:pb-2 sm:text-right">
            <div role="group" aria-label="Data mode" className="mb-3 flex items-center gap-5 sm:justify-end">
              {btn('live', 'Live', !liveAvailable)}
              {btn('sample', 'Sample')}
              {mode === 'sample' && <Badge kind="sample" />}
            </div>
            <p className="text-[13px] leading-[1.7] text-muted tabular-nums" aria-live="polite">
              {meta ? (
                <>
                  {parts[0]}<br />{parts.slice(1).join(' · ')}
                  {meta.quota && <><br /><span className="font-semibold text-ink">Live runs left: {meta.quota.liveRunsLeft}</span></>}
                </>
              ) : 'No run yet'}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
