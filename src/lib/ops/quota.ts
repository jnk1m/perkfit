import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { ApiError } from '@/lib/types';
import { getEnv } from './env';

export type QuotaKind = 'qloo_run' | 'llm_run' | 'search';

/** Daily limits (UTC day). Qloo and LLM are global; the rest are per client address. */
export const LIMITS = {
  qlooCallsPerDay: 400,
  llmRunsPerDay: 200,
  liveRunsPerIpPerDay: 10,
  searchesPerIpPerDay: 20,
} as const;

export interface QuotaStore {
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface QuotaOptions {
  /** Example segments are served from cache: always allowed and never counted. */
  example?: boolean;
  /** Qloo calls this request will make; counted against the global Qloo limit. Default 1. */
  qlooCalls?: number;
  store?: QuotaStore | null;
  now?: Date;
}

export type QuotaResult = { ok: true; liveRunsLeft?: number } | { ok: false; error: ApiError };

const TTL_SECONDS = 2 * 24 * 60 * 60;

let defaultStore: QuotaStore | null | undefined;

function getDefaultStore(): QuotaStore | null {
  if (defaultStore === undefined) {
    const env = getEnv();
    defaultStore =
      env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
        ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
        : process.env.NODE_ENV === 'development'
          ? memoryStore() // local dev only: lets the live search and custom paths be exercised without Upstash
          : null;
  }
  return defaultStore;
}

/** In-process counter for local development. Never used in production (serverless memory is per instance). */
function memoryStore(): QuotaStore {
  const counts = new Map<string, number>();
  return {
    async incrby(key, amount) {
      const next = (counts.get(key) ?? 0) + amount;
      counts.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

function exceeded(what: string): QuotaResult {
  return {
    ok: false,
    error: {
      code: 'quota_exceeded',
      message: `Daily limit reached for ${what}. Example segments are still available.`,
    },
  };
}

/**
 * Counts one request against the daily limits.
 * Without a store, custom live runs and searches are refused and examples pass.
 * A store failure refuses the request (fail closed) and logs the kind and the error message only.
 */
export async function checkQuota(kind: QuotaKind, ip: string, opts: QuotaOptions = {}): Promise<QuotaResult> {
  if (opts.example) return { ok: true };

  const store = opts.store === undefined ? getDefaultStore() : opts.store;
  if (!store) {
    return {
      ok: false,
      error: {
        code: 'quota_exceeded',
        message: 'Custom runs and search are turned off on this deployment. Example segments are still available.',
      },
    };
  }

  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const who = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const count = async (scope: string, amount: number): Promise<number> => {
    const key = `perkfit:${day}:${scope}`;
    const value = await store.incrby(key, amount);
    if (value === amount) await store.expire(key, TTL_SECONDS);
    return value;
  };

  try {
    if (kind === 'qloo_run') {
      const runs = await count(`ip:${who}:live`, 1);
      if (runs > LIMITS.liveRunsPerIpPerDay) return exceeded('live runs from this address');
      const calls = await count('qloo', opts.qlooCalls ?? 1);
      if (calls > LIMITS.qlooCallsPerDay) return exceeded('Qloo requests');
      return { ok: true, liveRunsLeft: LIMITS.liveRunsPerIpPerDay - runs };
    }
    if (kind === 'llm_run') {
      const runs = await count('llm', 1);
      if (runs > LIMITS.llmRunsPerDay) return exceeded('explanation runs');
      return { ok: true };
    }
    const searches = await count(`ip:${who}:search`, 1);
    if (searches > LIMITS.searchesPerIpPerDay) return exceeded('searches from this address');
    const calls = await count('qloo', 1);
    if (calls > LIMITS.qlooCallsPerDay) return exceeded('Qloo requests');
    return { ok: true };
  } catch (err) {
    console.error(`quota store failed (kind=${kind}): ${err instanceof Error ? err.message : String(err)}`);
    return {
      ok: false,
      error: { code: 'internal', message: 'Usage limits are temporarily unavailable. Example segments are still available.' },
    };
  }
}
