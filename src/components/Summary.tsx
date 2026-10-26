'use client';

import { useEffect, useRef, useState } from 'react';
import type { ViewModel } from '@/lib/ui/viewModel';

/** Three plain sentences in three columns on the ink result field, with an outlined COPY button. */
export function Summary({ summary }: { summary: NonNullable<ViewModel['summary']> }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary.copyText);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCopied(false); setFailed(false); }, 2000);
  }

  return (
    <div data-testid="summary" className="border-t border-on-dark/20 pt-5 text-[15px] text-on-dark">
      <ol className="grid list-none gap-6 md:grid-cols-3 md:gap-8">
        {summary.lines.map((l, i) => (
          <li key={i} className={i === 2 ? 'flex items-start justify-between gap-4' : ''}>
            <span className="min-w-0">{l}</span>
            {i === 2 && (
              <button
                type="button"
                onClick={() => void copy()}
                aria-live="polite"
                className="h-11 shrink-0 border border-on-dark/50 bg-transparent px-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-dark transition-colors hover:bg-on-dark hover:text-ink active:bg-on-dark/80 active:text-ink disabled:opacity-50 md:h-8"
              >
                {copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
