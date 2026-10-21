'use client';

import type { Segment } from '@/lib/types';
import { AGE_BANDS } from '@/lib/types';
import type { SegmentKey } from '@/lib/ui/reducer';
import { ChipSearch } from './ChipSearch';

const ageLabel = (b: string) => b.replace('_to_', ' to ').replace('_and_older', ' and older');
const TABS: { key: SegmentKey; label: string }[] = [
  { key: 'example_a', label: 'Example A' },
  { key: 'example_b', label: 'Example B' },
  { key: 'custom', label: 'Custom' },
];

export function SegmentPanel({
  segment, active, onSelect, onChange,
}: { segment: Segment; active: SegmentKey; onSelect: (k: SegmentKey) => void; onChange: (next: Segment) => void }) {
  const existing = new Set(segment.interests.map((c) => c.token));
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Segment" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={active === t.key}
            onClick={() => onSelect(t.key)}
            className={`h-11 border border-ink px-3 text-sm md:h-8 ${active === t.key ? 'bg-ink text-paper' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="font-semibold">{segment.label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="mr-1">Age</span>
          <select value={segment.age} onChange={(e) => onChange({ ...segment, age: e.target.value as Segment['age'] })} className="h-11 border border-ink/50 bg-white/60 px-1 md:h-9">
            {AGE_BANDS.map((b) => <option key={b} value={b}>{ageLabel(b)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mr-1">Gender</span>
          <select
            value={segment.gender ?? ''}
            onChange={(e) => onChange({ ...segment, gender: e.target.value === '' ? undefined : (e.target.value as 'male' | 'female') })}
            className="h-11 border border-ink/50 bg-white/60 px-1 md:h-9"
          >
            <option value="">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Interest chips">
        {segment.interests.map((c) => (
          <li key={c.token} className="flex items-center border border-ink bg-white/60 text-sm">
            <span className="px-2">{c.name}</span>
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() => onChange({ ...segment, interests: segment.interests.filter((x) => x.token !== c.token) })}
              className="h-11 w-11 border-l border-ink/40 md:h-8 md:w-8"
            >
              ×
            </button>
          </li>
        ))}
        {segment.interests.length === 0 && <li className="text-sm text-ink/80">No interests yet. Add at least one.</li>}
      </ul>
      <ChipSearch existing={existing} full={segment.interests.length >= 5} onAdd={(chip) => onChange({ ...segment, interests: [...segment.interests, chip] })} />
      <p className="text-xs text-ink/80">These chips are exactly what we send to Qloo. No personal data.</p>
    </div>
  );
}
