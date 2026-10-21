import { describe, expect, it, vi } from 'vitest';
import { createFakeQloo, entity } from '../helpers/fake-qloo';
import { encodePrecache, decodePrecache, Precache } from '@/lib/qloo/precache';
import { precacheKey } from '@/lib/qloo/precache';
import { CANDIDATE_MAP, CHIP_MAP, SEG_A, TEST_CANDIDATES, makeService, precacheData } from './_world';

vi.mock('server-only', () => ({}));

describe('error handling', () => {
  it('401: auth code, no retry, run stops, precache hits still succeed', async () => {
    // Build a precache with a good key first.
    const good = makeService(createFakeQloo());
    const goodCtx = good.createRunContext();
    const first = await good.scoreDomain('place', SEG_A, TEST_CANDIDATES, goodCtx);
    expect(first.envelope.code).toBe('ok');
    const decoded = decodePrecache(
      encodePrecache(precacheData({ entries: [{ key: placeKey(), code: 'ok', scores: first.stored!.scores }] })),
    );
    expect(decoded.ok).toBe(true);
    const precache = (decoded as { precache: Precache }).precache;

    const fake = createFakeQloo({ sendKey: 'wrong-key' });
    const svc = makeService(fake, { precache });
    const ctx = svc.createRunContext();
    const all = await svc.scoreSegment(SEG_A, TEST_CANDIDATES, ctx);

    expect(all.place.envelope.code).toBe('ok');
    expect(all.place.envelope.source).toBe('precache');
    for (const d of ['tv_show', 'brand', 'book'] as const) expect(all[d].envelope.code).toBe('auth');
    expect(ctx.stats.retries).toBe(0);
    expect(ctx.abort?.code).toBe('auth');
    // Concurrency 2: at most the two in-flight calls reach the network before the run stops.
    expect(fake.calls.length).toBeLessThanOrEqual(2);
    expect(fake.calls.every((c) => c.status === 401)).toBe(true);
    // Later network calls are skipped entirely.
    const before = fake.calls.length;
    const late = await svc.client.search({ query: 'Demo Band', type: 'artist', take: 5 }, ctx);
    expect(late.code).toBe('auth');
    expect(fake.calls.length).toBe(before);
  });

  it('429: one retry succeeds and is counted; three in a row cancel the rest', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    fake.inject({ status: 429, times: 1, retryAfterSec: 0 });
    const r = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    expect(r.envelope.code).toBe('ok');
    expect(ctx.stats.retries).toBe(1);
    expect(ctx.stats.networkCalls).toBe(2);

    const fake2 = createFakeQloo();
    const svc2 = makeService(fake2);
    const ctx2 = svc2.createRunContext();
    fake2.inject({ status: 429, times: 99, retryAfterSec: 0 });
    const all = await svc2.scoreSegment(SEG_A, TEST_CANDIDATES, ctx2);
    for (const d of ['place', 'tv_show', 'brand', 'book'] as const) {
      expect(all[d].envelope.code).toBe('rate_limited');
      expect(all[d].scores.filter((s) => s.reason === 'domain_error').length).toBeGreaterThan(0);
    }
    expect(ctx2.abort?.code).toBe('rate_limited');
    const before = fake2.calls.length;
    expect(before).toBeLessThan(8); // 4 domains x 2 attempts would be 8; the abort cut it short
    await svc2.client.search({ query: 'x', type: 'artist', take: 1 }, ctx2);
    expect(fake2.calls.length).toBe(before);
  });

  it('429 with a long Retry-After is not waited out', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    fake.inject({ status: 429, times: 5, retryAfterSec: 30 });
    const r = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    expect(r.envelope.code).toBe('rate_limited');
    expect(ctx.stats.retries).toBe(0);
    expect(fake.calls).toHaveLength(1);
  });

  it('5xx: one retry then upstream error, candidates become domain_error, fast', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    fake.inject({ status: 503, times: 2 });
    const t0 = Date.now();
    const r = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.envelope.code).toBe('upstream');
    expect(r.envelope.retryable).toBe(true);
    expect(r.envelope.httpStatus).toBe(503);
    expect(ctx.stats.retries).toBe(1);
    const place = r.scores;
    expect(place).toHaveLength(5);
    expect(place.every((s) => s.status === 'no_data' && s.reason === 'domain_error' && s.affinity === null)).toBe(true);
  });

  it('timeout: each attempt is cut, the run returns a partial result', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake, { callTimeoutMs: 40 });
    const ctx = svc.createRunContext();
    fake.inject({ delayMs: 2_000, times: 2, path: '/v2/insights' });
    const t0 = Date.now();
    const r = await svc.scoreDomain('book', SEG_A, TEST_CANDIDATES, ctx);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(r.envelope.code).toBe('upstream');
    expect(r.envelope.detail).toContain('timeout');
    expect(r.scores.every((s) => s.reason === 'domain_error')).toBe(true);
    // The next domain is unaffected.
    const ok = await svc.scoreDomain('brand', SEG_A, TEST_CANDIDATES, ctx);
    expect(ok.envelope.code).toBe('ok');
  });

  it('schema mismatch is reported by path only', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const broken = {
      transport: async () => ({ status: 200, body: { success: true, results: { entities: [{ name: 'x' }] } } }),
    };
    const { createQlooClient } = await import('@/lib/qloo/client');
    const { createPacer } = await import('@/lib/qloo/pacer');
    const client = createQlooClient({ transport: broken.transport, pacer: createPacer({ intervalMs: 0, concurrency: 1 }) });
    const env = await client.insights(
      { type: 'place', interestEntityIds: [entity('Synthetic Singer', 'artist').id], age: '25_to_29', candidateEntityIds: [entity('Harbor Deli', 'place').id] },
      ctx,
    );
    expect(env.code).toBe('upstream');
    expect(env.detail).toContain('schema_mismatch');
    expect(env.detail).toContain('results.entities.[].entity_id');
    expect(env.detail).not.toContain('"x"');
  });
});

/** Cache key the scorer uses for the place domain of segment A. */
function placeKey(): string {
  const ids = ['harbor_deli', 'corner_pizza', 'demo_burger', 'sample_bakery', 'test_smokehouse'].map((k) => CANDIDATE_MAP[k]!);
  return precacheKey({ age: SEG_A.age, interestEntityIds: SEG_A.interests.map((i) => CHIP_MAP[i.token]) }, ids);
}
