'use client';

import { useId, useRef, useState } from 'react';
import { parseEdit, type EditKind } from '@/lib/ui/validate';

/**
 * A number cell that commits on blur or Enter. Out-of-range input is not applied and the reason stays
 * visible until the next valid edit or Esc.
 */
export function EditableNumber({
  value, kind, label, onCommit, format = (n) => String(n), className = 'w-24', edited = false,
}: {
  value: number; kind: EditKind; label: string; onCommit: (v: number) => void; format?: (n: number) => string; className?: string; edited?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft === null) return;
    const parsed = parseEdit(kind, draft);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setError(null);
    setDraft(null);
    if (parsed.value !== value) onCommit(parsed.value);
  };

  return (
    <span className="inline-block max-w-full">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        value={draft ?? format(value)}
        onFocus={(e) => { if (draft === null) setDraft(String(value)); e.currentTarget.select(); }}
        onChange={(e) => { setDraft(e.target.value); setError(null); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelled.current = true; setDraft(null); setError(null); e.currentTarget.blur(); }
        }}
        className={`${className} min-h-11 border-b border-ink bg-transparent px-1 text-right tabular-nums transition-colors hover:bg-paper-2 md:min-h-9${edited ? ' border-dotted border-sienna' : ''}`}
      />
      {error && <span id={errId} role="alert" className="block max-w-48 text-xs text-sienna">{error}</span>}
    </span>
  );
}
