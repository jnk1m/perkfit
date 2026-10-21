import 'server-only';

/** Time budgets in milliseconds. One table, shared by the client and the scorer (DESIGN decision 12). */
export const TIMEOUTS = {
  /** One HTTP attempt. */
  callMs: 12_000,
  /** All attempts for one domain, including the retry. */
  domainMs: 25_000,
  /** Whole run; the orchestrator may pass its own deadline instead. */
  runMs: 45_000,
  /** Wait before the single retry when the server gives no Retry-After. */
  retryDelayMs: 1_000,
  /** A Retry-After above this is not honored; the call fails as rate limited. */
  retryAfterMaxMs: 5_000,
} as const;

export const PACING = { intervalMs: 500, concurrency: 2 } as const;

export const DEFAULT_BASE_URL = 'https://hackathon.api.qloo.com';

export interface QlooConfig {
  /** Undefined when no key is configured; the transport then answers 401 without a network call. */
  apiKey?: string;
  baseUrl: string;
}

/** Reads QLOO_API_KEY and QLOO_BASE_URL. The key never leaves this object. */
export function loadQlooConfig(env: Record<string, string | undefined> = process.env): QlooConfig {
  const apiKey = env.QLOO_API_KEY?.trim() || undefined;
  const baseUrl = (env.QLOO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}
