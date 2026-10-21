'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApiError } from '@/lib/types';

const COPY: Record<ApiError['code'], string> = {
  invalid_request: 'This input was rejected.',
  qloo_unavailable: 'Qloo is unavailable right now.',
  qloo_rate_limited: 'Qloo is busy.',
  quota_exceeded: "You've used all live runs for now. Everything on screen still recalculates as you edit. Sample mode is unlimited.",
  timeout: 'The run took too long and was stopped.',
  internal: 'Something went wrong on our side.',
};

export function ErrorBox({ error, onRetry, onSample }: { error: ApiError; onRetry: () => void; onSample: () => void }) {
  const [left, setLeft] = useState(error.code === 'qloo_rate_limited' ? (error.retryAfterSec ?? null) : null);
  const fired = useRef(false);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      if (!fired.current) { fired.current = true; onRetry(); }
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onRetry]);

  const showRetry = error.code !== 'quota_exceeded' && error.code !== 'invalid_request';
  const showSample = error.code === 'qloo_unavailable' || error.code === 'quota_exceeded' || error.code === 'qloo_rate_limited';
  return (
    <div role="alert" className="border-2 border-ink bg-white/60 p-3 text-sm">
      <p className="font-semibold">{COPY[error.code]}</p>
      {error.code !== 'quota_exceeded' && <p className="mt-1 text-ink/85">{error.message}</p>}
      {left !== null && left > 0 && <p className="mt-1 tabular-nums">Retrying once in {left}s.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {showRetry && <button type="button" onClick={onRetry} className="h-11 border border-ink px-3 md:h-8">Retry</button>}
        {showSample && <button type="button" onClick={onSample} className="h-11 border border-ink px-3 md:h-8">Switch to sample mode</button>}
      </div>
    </div>
  );
}
