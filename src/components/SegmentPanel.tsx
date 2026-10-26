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
    <div className="space-y-4">
      <div role="group" aria-label="Segment" className="flex flex-wrap gap-x-5 gap-y-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={active === t.key}
            onClick={() => onSelect(t.key)}
            className={`label min-h-11 border-b-2 font-semibold transition-colors md:min-h-8 ${active === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="font-display text-[28px] leading-[1.15]">{segment.label}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="text-sm text-muted">
          <span className="mr-2">Age</span>
          <select value={segment.age} onChange={(e) => onChange({ ...segment, age: e.target.value as Segment['age'] })} className="min-h-11 border-b border-ink bg-transparent pr-1 text-ink md:min-h-8">
            {AGE_BANDS.map((b) => <option key={b} value={b}>{ageLabel(b)}</option>)}
          </select>
        </label>
        <label className="text-sm text-muted">
          <span className="mr-2">Gender</span>
          <select
            value={segment.gender ?? ''}
            onChange={(e) => onChange({ ...segment, gender: e.target.value === '' ? undefined : (e.target.value as 'male' | 'female') })}
            className="min-h-11 border-b border-ink bg-transparent pr-1 text-ink md:min-h-8"
          >
            <option value="">Any</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Interest chips">
        {segment.interests.map((c) => (
          <li key={c.token} className="flex items-center rounded-full border border-ink text-sm">
            <span className="py-1 pl-3 pr-1">{c.name}</span>
            <button
              type="button"
              aria-label={`Remove ${c.name}`}
              onClick={() => onChange({ ...segment, interests: segment.interests.filter((x) => x.token !== c.token) })}
              className="size-11 rounded-full text-muted transition-colors hover:text-wine md:size-8"
            >
              ×
            </button>
          </li>
        ))}
        {segment.interests.length === 0 && <li className="text-sm text-muted">No interests yet. Add at least one.</li>}
      </ul>
      <ChipSearch existing={existing} full={segment.interests.length >= 5} onAdd={(chip) => onChange({ ...segment, interests: [...segment.interests, chip] })} />
      <p className="text-[13px] text-muted">These chips are exactly what we send to Qloo. No personal data.</p>
    </div>
  );
}
