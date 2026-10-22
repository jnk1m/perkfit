'use client';

import { useEffect, useRef, useState } from 'react';
import type { ViewModel } from '@/lib/ui/viewModel';

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
    <div data-testid="summary" className="flex items-start gap-3 border border-ink/40 bg-white/50 px-3 py-3">
      <ol className="min-w-0 flex-1 list-none space-y-1 text-sm md:text-base">
        {summary.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
      <button type="button" onClick={() => void copy()} className="h-11 shrink-0 border border-ink px-3 text-sm md:h-8" aria-live="polite">
        {copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
      </button>
    </div>
  );
}
