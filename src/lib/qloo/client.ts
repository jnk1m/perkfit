import 'server-only';
import type { ZodType } from 'zod';
import { PACING, TIMEOUTS } from './config';
import { failEnvelope, okEnvelope } from './envelope';
import { guardInsights, normalizeId } from './guard';
import { createPacer, type Pacer } from './pacer';
import {
  decodeHtmlEntities,
  errorResponseSchema,
  insightsResponseSchema,
  issuePaths,
  searchResponseSchema,
  type InsightsResponse,
  type SearchResponse,
} from './schemas';
import type { QlooTransport, TransportResponse } from './transport';
import type {
  InsightsEntity,
  InsightsQuery,
  QlooEnvelope,
  QlooStats,
  RunContext,
  SearchHit,
  SearchQuery,
} from './types';

export interface QlooClientOptions {
  transport: QlooTransport;
  pacer?: Pacer;
  now?: () => number;
  callTimeoutMs?: number;
  retryDelayMs?: number;
  retryAfterMaxMs?: number;
}

export interface CallOptions {
  /** Absolute time after which no attempt may start. Defaults to the run deadline. */
  deadlineAt?: number;
}

export interface QlooClient {
  /** GET /search. Never throws. */
  search(q: SearchQuery, ctx: RunContext, opts?: CallOptions): Promise<QlooEnvelope<SearchHit[]>>;
  /** GET /v2/insights after the pre-flight guard. Never throws. */
  insights(q: InsightsQuery, ctx: RunContext, opts?: CallOptions): Promise<QlooEnvelope<InsightsEntity[]>>;
}

/** Fresh per-run state. `deadlineMs` is relative to now. */
export function createRunContext(opts: { deadlineMs?: number; now?: () => number } = {}): RunContext {
  const now = opts.now ?? Date.now;
  const stats: QlooStats = { networkCalls: 0, cacheHits: 0, retries: 0, noData: 0, noMatch: 0 };
  return { deadlineAt: now() + (opts.deadlineMs ?? TIMEOUTS.runMs), stats, consecutiveRateLimited: 0 };
}

type Attempt =
  | { kind: 'http'; res: TransportResponse }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'skipped'; code: 'auth' | 'rate_limited' | 'deadline' };

const RATE_LIMIT_ABORT_AFTER = 3;
const MAX_ATTEMPTS = 2;

/** Builds the client around one transport and one pacer; the pacer is shared by all calls through it. */
export function createQlooClient(options: QlooClientOptions): QlooClient {
  const now = options.now ?? Date.now;
  const callTimeoutMs = options.callTimeoutMs ?? TIMEOUTS.callMs;
  const retryDelayMs = options.retryDelayMs ?? TIMEOUTS.retryDelayMs;
  const retryAfterMaxMs = options.retryAfterMaxMs ?? TIMEOUTS.retryAfterMaxMs;
  const pacer = options.pacer ?? createPacer({ ...PACING, now });
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function attempt(
    path: '/search' | '/v2/insights',
    params: Record<string, string>,
    ctx: RunContext,
    deadlineAt: number,
  ): Promise<Attempt> {
    return pacer.run(async (): Promise<Attempt> => {
      // Checked again here because the call may have waited in the pacer queue.
      if (ctx.abort) return { kind: 'skipped', code: ctx.abort.code };
      const remaining = Math.min(deadlineAt, ctx.deadlineAt) - now();
      if (remaining <= 0) return { kind: 'skipped', code: 'deadline' };
      ctx.stats.networkCalls++;
      const ac = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<Attempt>((resolve) => {
        timer = setTimeout(() => {
          ac.abort();
          resolve({ kind: 'timeout' });
        }, Math.min(callTimeoutMs, remaining));
      });
      const request = options
        .transport({ path, params, signal: ac.signal })
        .then<Attempt, Attempt>((res) => ({ kind: 'http', res }), () => ({ kind: 'network' }));
      try {
        const out = await Promise.race([request, timeout]);
        // Run-level stop signals are set here, before the pacer frees its slot, so queued calls see them.
        if (out.kind === 'http') {
          if (out.res.status === 401) ctx.abort = { code: 'auth' };
          if (out.res.status === 429) {
            ctx.consecutiveRateLimited++;
            if (ctx.consecutiveRateLimited >= RATE_LIMIT_ABORT_AFTER) ctx.abort = { code: 'rate_limited' };
          } else {
            ctx.consecutiveRateLimited = 0;
          }
        }
        return out;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** Shared call loop: one try plus at most one retry, then classification into an envelope. */
  async function call<P, T>(
    path: '/search' | '/v2/insights',
    params: Record<string, string>,
    ctx: RunContext,
    opts: CallOptions | undefined,
    schema: ZodType<P>,
    shape: (parsed: P) => T,
    label: string,
  ): Promise<QlooEnvelope<T>> {
    const started = now();
    const deadlineAt = Math.min(opts?.deadlineAt ?? ctx.deadlineAt, ctx.deadlineAt);
    const elapsed = () => Math.max(0, now() - started);

    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const a = await attempt(path, params, ctx, deadlineAt);

      if (a.kind === 'skipped') {
        if (a.code === 'deadline') return failEnvelope('upstream', elapsed(), { detail: `${label}: deadline reached`, retryable: true });
        return failEnvelope(a.code, elapsed(), { detail: `${label}: run stopped after ${a.code}` });
      }

      let retryWaitMs: number | undefined;
      let fail: QlooEnvelope<T>;

      if (a.kind === 'timeout' || a.kind === 'network') {
        retryWaitMs = retryDelayMs;
        fail = failEnvelope('upstream', elapsed(), { detail: `${label}: ${a.kind}`, retryable: true });
      } else {
        const { status, body, retryAfterSec } = a.res;
        if (status === 200) {
          const parsed = schema.safeParse(body);
          if (!parsed.success) {
            return failEnvelope('upstream', elapsed(), { detail: `${label}: schema_mismatch at ${issuePaths(parsed.error)}`, httpStatus: 200 });
          }
          if ((parsed.data as { success?: boolean }).success === false) {
            return failEnvelope('upstream', elapsed(), { detail: `${label}: success=false`, httpStatus: 200 });
          }
          const data = shape(parsed.data);
          return okEnvelope(data, elapsed(), 'network', 200);
        }
        if (status === 401) {
          return failEnvelope('auth', elapsed(), { detail: `${label}: http_401`, httpStatus: 401 });
        }
        if (status === 403) return failEnvelope('auth', elapsed(), { detail: `${label}: http_403`, httpStatus: 403 });
        if (status === 400) {
          const err = errorResponseSchema.safeParse(body);
          const noSignal = err.success && err.data.errors.some((e) => /at least one valid signal/i.test(e.message));
          return failEnvelope(noSignal ? 'no_signal' : 'upstream', elapsed(), {
            detail: `${label}: http_400${noSignal ? ' no valid signal' : ''}`,
            httpStatus: 400,
            retryable: false,
          });
        }
        if (status === 429) {
          const waitMs = (retryAfterSec ?? retryDelayMs / 1000) * 1000;
          // A long Retry-After is not waited out inside a request.
          retryWaitMs = waitMs <= retryAfterMaxMs ? waitMs : undefined;
          fail = failEnvelope('rate_limited', elapsed(), { detail: `${label}: http_429`, httpStatus: 429, retryable: true });
        } else if (status >= 500) {
          retryWaitMs = retryDelayMs;
          fail = failEnvelope('upstream', elapsed(), { detail: `${label}: http_${status}`, httpStatus: status, retryable: true });
        } else {
          return failEnvelope('upstream', elapsed(), { detail: `${label}: http_${status}`, httpStatus: status, retryable: false });
        }
      }

      const canRetry = n < MAX_ATTEMPTS && retryWaitMs !== undefined && !ctx.abort && now() + retryWaitMs < deadlineAt;
      if (!canRetry) return fail;
      ctx.stats.retries++;
      await sleep(retryWaitMs!);
    }
    // Unreachable: the loop returns on its last iteration.
    return failEnvelope('upstream', elapsed(), { detail: `${label}: exhausted` });
  }

  return {
    search(q, ctx, opts) {
      const params: Record<string, string> = { query: q.query, types: `urn:entity:${q.type}`, take: String(q.take) };
      return call<SearchResponse, SearchHit[]>(
        '/search',
        params,
        ctx,
        opts,
        searchResponseSchema,
        (p) =>
          p.results.map((r) => ({
            entityId: normalizeId(r.entity_id),
            name: decodeHtmlEntities(r.name),
            types: r.types,
            popularity: r.popularity ?? null,
            ...(r.disambiguation ? { disambiguation: decodeHtmlEntities(r.disambiguation) } : {}),
            ...(r.properties?.geocode?.city ? { city: r.properties.geocode.city } : {}),
            ...(r.properties?.geocode?.metro ? { metro: r.properties.geocode.metro } : {}),
          })),
        `search ${q.type}`,
      ).then((env) => {
        if (env.code === 'ok' && env.data!.length === 0) return { ...env, code: 'empty' as const, detail: 'search: no results' };
        return env;
      });
    },

    async insights(q, ctx, opts) {
      const guarded = guardInsights(q);
      if (!guarded.ok) return failEnvelope('no_signal', 0, { detail: guarded.detail });
      const label = `insights ${q.type}`;
      const env = await call<InsightsResponse, InsightsEntity[]>(
        '/v2/insights',
        guarded.params,
        ctx,
        opts,
        insightsResponseSchema,
        (p) =>
          p.results.entities.map((e) => {
            const raw = e.query?.affinity;
            return {
              entityId: normalizeId(e.entity_id),
              name: decodeHtmlEntities(e.name),
              ...(e.subtype ? { subtype: e.subtype } : {}),
              popularity: e.popularity ?? null,
              affinity: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
              explain: (e.query?.explainability?.['signal.interests.entities'] ?? []).map((x) => ({
                entityId: normalizeId(x.entity_id),
                score: x.score,
              })),
            };
          }),
        label,
      );
      if (env.code !== 'ok') return env;
      const entities = env.data!;
      // A valid query that returns nothing is a real empty result, distinct from a rejected query.
      if (entities.length === 0) return { ...env, code: 'empty', detail: `${label}: empty_valid` };
      if (entities.every((e) => e.affinity === null)) return { ...env, code: 'no_signal', detail: `${label}: no_affinity` };
      return env;
    },
  };
}
