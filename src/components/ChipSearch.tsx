'use client';

import { useId, useRef, useState } from 'react';
import type { SearchResponse } from '@/lib/api/types';
import type { ApiError, InterestChip } from '@/lib/types';

type Result = SearchResponse['results'][number];

/**
 * Entity search for interest chips. Never auto-selects: the user must move to a result and press Enter or click.
 */
export function ChipSearch({ existing, full, onAdd }: { existing: Set<string>; full: boolean; onAdd: (chip: InterestChip) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const listId = useId();

  const search = async (text: string) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: c.signal });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: ApiError } | null;
        throw new Error(body?.error?.message ?? `Search failed (HTTP ${res.status})`);
      }
      const body = (await res.json()) as SearchResponse;
      setResults(body.results.slice(0, 5));
      setStatus('done');
      setOpen(true);
      setActive(-1);
    } catch (err) {
      if (c.signal.aborted) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const onInput = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      ctl.current?.abort();
      setResults([]);
      setStatus('idle');
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => void search(text.trim()), 250);
  };

  const pick = (r: Result) => {
    if (existing.has(r.token)) return;
    onAdd({ token: r.token, name: r.name });
    setQ('');
    setResults([]);
    setOpen(false);
    setStatus('idle');
  };

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={`${listId}-in`}>Add an interest</label>
      <input
        id={`${listId}-in`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        disabled={full}
        value={q}
        placeholder={full ? 'Chip limit reached (5)' : '+ add interest (title, brand, place…)'}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(results.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(results[active]); }
          else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
        }}
        className="h-11 w-full min-w-56 border border-ink/50 bg-white/60 px-2 text-sm md:h-9"
      />
      <ul id={listId} role="listbox" aria-label="Search results" hidden={!open || results.length === 0} className="absolute z-10 mt-1 w-full border border-ink bg-paper shadow-sm">
        {results.map((r, i) => {
          const added = existing.has(r.token);
          return (
            <li
              key={r.token}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={added || undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className={`cursor-pointer px-2 py-2 text-sm ${i === active ? 'bg-ink text-paper' : ''} ${added ? 'opacity-50' : ''}`}
            >
              <span className="font-semibold">{r.name}</span>
              <span className="ml-2 text-xs opacity-80">{r.hint ?? r.type}{added ? ' (added)' : ''}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs" aria-live="polite">
        {status === 'loading' && 'Searching…'}
        {status === 'done' && results.length === 0 && 'No match. Try another name.'}
        {status === 'done' && results.length > 0 && 'Pick one result. Nothing is added automatically.'}
        {error && <span role="alert" className="text-assume">{error}</span>}
      </p>
    </div>
  );
}
