import type { RunStage } from '@/lib/api/types';
import type { StageState } from '@/lib/ui/reducer';

const ROWS: { label: string; stages: RunStage[] }[] = [
  { label: 'Resolving segment', stages: ['resolve'] },
  { label: 'Scoring places', stages: ['score_place'] },
  { label: 'Scoring TV shows', stages: ['score_tv_show'] },
  { label: 'Scoring brands', stages: ['score_brand'] },
  { label: 'Scoring books', stages: ['score_book'] },
  { label: 'Asking an LLM alone', stages: ['llm_alone'] },
  { label: 'Computing bundle', stages: ['optimize'] },
  { label: 'Writing and checking explanations', stages: ['explain', 'validate'] },
];

function rowState(stages: Partial<Record<RunStage, StageState>>, ids: RunStage[]): StageState | null {
  const states = ids.map((i) => stages[i]).filter((x): x is StageState => Boolean(x));
  if (states.length === 0) return null;
  if (states.some((s) => s.status === 'error')) return { status: 'error' };
  if (states.some((s) => s.status === 'start')) return { status: 'start' };
  const ms = states.reduce((t, s) => t + (s.ms ?? 0), 0);
  return states.every((s) => s.status === 'skip') ? { status: 'skip' } : { status: 'done', ms: ms || undefined };
}

export function RunProgress({ stages, visible }: { stages: Partial<Record<RunStage, StageState>>; visible: boolean }) {
  return (
    <div aria-live="polite">
      {visible && (
        <ul className="divide-y divide-ink/15 border-y border-ink/30 text-sm">
          {ROWS.map((r) => {
            const st = rowState(stages, r.stages);
            const mark = !st ? '○ pending' : st.status === 'start' ? 'working' : st.status === 'done' ? '✓ done' : st.status === 'skip' ? '– skipped' : '! failed';
            return (
              <li key={r.label} className="flex items-center gap-3 py-1.5">
                <span className="w-24 shrink-0 tabular-nums text-ink/80">
                  {st?.status === 'start' && <span aria-hidden className="mr-1 inline-block size-3 animate-spin rounded-full border-2 border-ink border-t-transparent align-middle" />}
                  {mark}
                </span>
                <span className="flex-1">{r.label}</span>
                {st?.ms !== undefined && <span className="tabular-nums text-ink/70">{st.ms} ms</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
