import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import world from '../fixtures/synthetic/qloo/world.json';
import type { QlooTransport, TransportRequest, TransportResponse } from '@/lib/qloo/transport';

/**
 * Fake Qloo for tests. Pure `handler` plus an injectable `transport`, so there is no port.
 * `startFakeHttpServer` wraps the same handler for the one test that exercises the real fetch path.
 * All data comes from tests/fixtures/synthetic/qloo/world.json (hand-made values, fake ids).
 */

export const FAKE_KEY = 'synthetic-test-key-0000';

export interface FixtureEntity {
  id: string;
  name: string;
  type: string;
  popularity: number | null;
  ageFit?: Record<string, number>;
  city?: string;
  metro?: string;
  disambiguation?: string;
  /** Silently missing from insights results although requested. */
  omit?: boolean;
  /** Returned without `query.affinity`. */
  noAffinity?: boolean;
  /** Returned with this raw affinity (to test out-of-range values). */
  rawAffinity?: number;
}

export const ENTITIES = (world as { entities: FixtureEntity[] }).entities;

export function entity(name: string, type: string, nth = 0): FixtureEntity {
  const found = ENTITIES.filter((e) => e.name === name && e.type === `urn:entity:${type}`)[nth];
  if (!found) throw new Error(`fixture entity not found: ${name} (${type}) #${nth}`);
  return found;
}

export interface FakeRequest {
  path: string;
  params: Record<string, string>;
  apiKey?: string;
}
export interface FakeResponse {
  status: number;
  body: unknown;
  retryAfterSec?: number;
}

const KNOWN_PARAMS = new Set([
  'filter.type',
  'signal.interests.entities',
  'signal.demographics.age',
  'signal.demographics.gender',
  'filter.results.entities',
  'feature.explainability',
  'take',
]);
const KNOWN_TYPES = new Set(['place', 'tv_show', 'brand', 'book', 'artist', 'movie', 'podcast']);

const clamp = (n: number) => Math.min(0.99, Math.max(0.05, n));
const tail = (id: string) => parseInt(id.slice(-2), 16);

/** Small deterministic per-(entity, interest) shift, so interests move scores a little and age moves them a lot. */
function interestShift(entityId: string, interestId: string): number {
  return (((tail(entityId) * 7 + tail(interestId) * 3) % 7) - 3) * 0.01;
}

const norm = (s: string) => s.toUpperCase();

export function fakeHandler(req: FakeRequest, expectedKey = FAKE_KEY): FakeResponse {
  if (req.apiKey !== expectedKey) return { status: 401, body: { errors: [{ message: 'invalid api key' }] } };

  if (req.path === '/search') {
    const q = (req.params.query ?? '').toLowerCase();
    const type = req.params.types ?? '';
    const take = Number(req.params.take ?? 20);
    const hits = ENTITIES.filter((e) => e.type === type && e.name.replace(/&amp;/g, '&').toLowerCase().includes(q))
      .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1))
      .slice(0, take)
      .map((e) => ({
        entity_id: e.id,
        name: e.name,
        types: [e.type],
        popularity: e.popularity,
        ...(e.disambiguation ? { disambiguation: e.disambiguation } : {}),
        properties: e.city ? { geocode: { city: e.city, metro: e.metro } } : {},
      }));
    return { status: 200, body: { results: hits } };
  }

  if (req.path === '/v2/insights') {
    const typeParam = req.params['filter.type'] ?? '';
    const type = typeParam.replace('urn:entity:', '');
    if (!typeParam.startsWith('urn:entity:') || !KNOWN_TYPES.has(type)) {
      return { status: 400, body: { errors: [{ message: 'not supported for filter.type' }] } };
    }
    // The trap: wrong parameter names are ignored and the call "succeeds" with nothing.
    if (Object.keys(req.params).some((k) => !KNOWN_PARAMS.has(k))) {
      return { status: 200, body: { success: true, results: { entities: [] } } };
    }
    const interests = (req.params['signal.interests.entities'] ?? '').split(',').filter(Boolean).map(norm);
    const age = req.params['signal.demographics.age'];
    const wanted = (req.params['filter.results.entities'] ?? '').split(',').filter(Boolean).map(norm);
    if (interests.length === 0 && !age && wanted.length === 0) {
      return { status: 400, body: { errors: [{ message: 'at least one valid signal or filter is required for entity insights' }] } };
    }
    const hasSignal = interests.length > 0 || !!age;
    const explain = req.params['feature.explainability'] === 'true';
    const take = Number(req.params.take ?? 20);

    const rows = ENTITIES.filter((e) => e.type === `urn:entity:${type}` && !e.omit && (wanted.length === 0 || wanted.includes(norm(e.id))))
      .map((e) => {
        let affinity: number | undefined;
        if (hasSignal && !e.noAffinity) {
          if (e.rawAffinity !== undefined) affinity = e.rawAffinity;
          else {
            const base = (age && e.ageFit?.[age]) || 0.5;
            affinity = clamp(base + interests.reduce((sum, i) => sum + interestShift(e.id, i), 0));
          }
        }
        return { e, affinity };
      })
      .sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1))
      .slice(0, take)
      .map(({ e, affinity }) => ({
        entity_id: e.id,
        name: e.name,
        type: 'urn:entity',
        subtype: e.type,
        popularity: e.popularity,
        query: {
          ...(affinity !== undefined ? { affinity } : {}),
          ...(explain && interests.length > 0
            ? { explainability: { 'signal.interests.entities': interests.map((i) => ({ entity_id: i, score: 0.3 })) } }
            : {}),
        },
      }));
    return { status: 200, body: { success: true, results: { entities: rows } } };
  }

  return { status: 404, body: { errors: [{ message: 'not found' }] } };
}

export interface Injection {
  /** HTTP status to answer with; omit to only add a delay and then answer normally. */
  status?: number;
  /** How many matching calls are affected. Default 1. */
  times?: number;
  delayMs?: number;
  retryAfterSec?: number;
  path?: '/search' | '/v2/insights';
}

export interface FakeCall {
  path: string;
  params: Record<string, string>;
  at: number;
  status: number;
}

export interface FakeQloo {
  transport: QlooTransport;
  calls: FakeCall[];
  inject(i: Injection): void;
  reset(): void;
}

export interface FakeOptions {
  /** Key the fake "sends". Defaults to the valid key. */
  sendKey?: string;
  now?: () => number;
  /** Requests allowed per second before 429. Default 3. */
  perSecondLimit?: number;
}

/** Transport backed by `fakeHandler`, with 429 above the per-second limit, error injection and a call log. */
export function createFakeQloo(opts: FakeOptions = {}): FakeQloo {
  const now = opts.now ?? Date.now;
  const limit = opts.perSecondLimit ?? 3;
  const calls: FakeCall[] = [];
  let injections: Array<Injection & { left: number }> = [];

  const transport: QlooTransport = async (req: TransportRequest): Promise<TransportResponse> => {
    const at = now();
    const inj = injections.find((i) => i.left > 0 && (!i.path || i.path === req.path));
    if (inj) inj.left--;
    if (inj?.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, inj.delayMs);
        req.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    }
    let res: FakeResponse;
    if (inj?.status !== undefined) {
      res = { status: inj.status, body: inj.status === 429 ? { errors: [{ message: 'slow down' }] } : { errors: [{ message: 'injected' }] }, retryAfterSec: inj.retryAfterSec };
    } else if (calls.filter((c) => c.at > at - 1000).length >= limit) {
      res = { status: 429, body: { errors: [{ message: 'rate limit' }] } };
    } else {
      res = fakeHandler({ path: req.path, params: req.params, apiKey: opts.sendKey ?? FAKE_KEY });
    }
    calls.push({ path: req.path, params: req.params, at, status: res.status });
    return { status: res.status, body: res.body, retryAfterSec: res.retryAfterSec };
  };

  return {
    transport,
    calls,
    inject: (i) => injections.push({ ...i, left: i.times ?? 1 }),
    reset: () => {
      calls.length = 0;
      injections = [];
    },
  };
}

/** The same handler behind a real HTTP server on a random local port. */
export async function startFakeHttpServer(): Promise<{ baseUrl: string; seenKeys: string[]; close: () => Promise<void> }> {
  const seenKeys: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const apiKey = req.headers['x-api-key'];
    seenKeys.push(typeof apiKey === 'string' ? apiKey : '');
    const out = fakeHandler({ path: url.pathname, params: Object.fromEntries(url.searchParams), apiKey: typeof apiKey === 'string' ? apiKey : undefined });
    res.writeHead(out.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seenKeys,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
