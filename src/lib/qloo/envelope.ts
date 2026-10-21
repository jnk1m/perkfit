import type { EnvelopeSource, QlooCode, QlooEnvelope } from './types';

export function okEnvelope<T>(data: T, latencyMs: number, source: EnvelopeSource, httpStatus?: number): QlooEnvelope<T> {
  return { code: 'ok', retryable: false, data, httpStatus, latencyMs, source };
}

const RETRYABLE: Record<QlooCode, boolean> = {
  ok: false,
  empty: false,
  no_signal: false,
  auth: false,
  rate_limited: true,
  upstream: false,
};

/** Non-ok envelope. `retryable` defaults by code; upstream failures say so explicitly. */
export function failEnvelope<T = never>(
  code: Exclude<QlooCode, 'ok'>,
  latencyMs: number,
  opts: { detail: string; httpStatus?: number; retryable?: boolean; source?: EnvelopeSource; data?: T },
): QlooEnvelope<T> {
  return {
    code,
    retryable: opts.retryable ?? RETRYABLE[code],
    data: opts.data,
    httpStatus: opts.httpStatus,
    latencyMs,
    source: opts.source ?? 'network',
    detail: opts.detail,
  };
}
