import 'server-only';
import type { QlooConfig } from './config';

export interface TransportRequest {
  path: '/search' | '/v2/insights';
  params: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  retryAfterSec?: number;
  /** Parsed JSON, or undefined when the body was not JSON. */
  body: unknown;
}

/**
 * The only door to Qloo. Resolves for any HTTP status and rejects only for network failures or aborts.
 * Tests inject a handler-backed implementation; production uses `fetchTransport`.
 */
export type QlooTransport = (req: TransportRequest) => Promise<TransportResponse>;

/** Real transport: GET with the `X-Api-Key` header. Without a key it answers 401 and makes no request. */
export function fetchTransport(config: QlooConfig, fetchImpl: typeof fetch = globalThis.fetch): QlooTransport {
  return async ({ path, params, signal }) => {
    if (!config.apiKey) return { status: 401, body: undefined };
    const url = new URL(path, config.baseUrl + '/');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
      signal,
      cache: 'no-store',
    });
    const retryAfter = Number(res.headers.get('retry-after'));
    const body: unknown = await res.json().catch(() => undefined);
    return { status: res.status, retryAfterSec: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined, body };
  };
}
