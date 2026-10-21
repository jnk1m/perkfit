import { describe, expect, it, vi } from 'vitest';
import { createFakeQloo } from '../helpers/fake-qloo';
import { SCHEMA_VERSION, decodePrecache, encodePrecache, loadPrecacheFromEnv, precacheKey } from '@/lib/qloo/precache';
import { CANDIDATE_MAP, SEG_A, SEG_A_REORDERED, TEST_CANDIDATES, makeService, precacheData } from './_world';
import { entity } from '../helpers/fake-qloo';

vi.mock('server-only', () => ({}));

describe('cache', () => {
  it('same call twice hits the network once; chip order does not matter; age does', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const a = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    const b = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    expect(fake.calls).toHaveLength(1);
    expect(a.envelope.source).toBe('network');
    expect(b.envelope.source).toBe('memory');
    expect(b.scores).toEqual(a.scores);
    expect(ctx.stats.cacheHits).toBe(1);

    const c = await svc.scoreDomain('place', SEG_A_REORDERED, TEST_CANDIDATES, ctx);
    expect(fake.calls).toHaveLength(1);
    expect(c.envelope.source).toBe('memory');
    expect(c.scores.map((s) => s.affinity)).toEqual(a.scores.map((s) => s.affinity));

    await svc.scoreDomain('place', { ...SEG_A, age: '30_to_34' }, TEST_CANDIDATES, ctx);
    expect(fake.calls).toHaveLength(2);
  });

  it('explain tokens follow the requesting segment, not the one that filled the cache', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    const renamed = { ...SEG_A, interests: SEG_A.interests.map((c, i) => ({ ...c, token: ['a2', 'a3', 'a1'][i] })) };
    const hit = await svc.scoreDomain('place', renamed, TEST_CANDIDATES, ctx);
    expect(fake.calls).toHaveLength(1);
    expect(hit.scores[0].explain.length).toBe(3);
  });

  it('errors are not stored', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    fake.inject({ status: 503, times: 2 });
    expect((await svc.scoreDomain('brand', SEG_A, TEST_CANDIDATES, ctx)).envelope.code).toBe('upstream');
    const again = await svc.scoreDomain('brand', SEG_A, TEST_CANDIDATES, ctx);
    expect(again.envelope.code).toBe('ok');
    expect(again.envelope.source).toBe('network');
    expect(fake.calls).toHaveLength(3);
  });

  it('precache hit has source precache and makes no call', async () => {
    const warm = makeService(createFakeQloo());
    const first = await warm.scoreDomain('brand', SEG_A, TEST_CANDIDATES, warm.createRunContext());
    const ids = TEST_CANDIDATES.filter((c) => c.domain === 'brand').map((c) => CANDIDATE_MAP[c.id]!);
    const key = precacheKey({ age: SEG_A.age, interestEntityIds: ['a1', 'a2', 'a3'].map((t) => warm.precache!.chipEntityId(t)!) }, ids);
    const blob = encodePrecache(precacheData({ entries: [{ key, code: 'ok', scores: first.stored!.scores }] }));
    const decoded = decodePrecache(blob);
    if (!decoded.ok) throw new Error(decoded.reason);

    const fake = createFakeQloo();
    const svc = makeService(fake, { precache: decoded.precache });
    const r = await svc.scoreDomain('brand', SEG_A, TEST_CANDIDATES, svc.createRunContext());
    expect(r.envelope.source).toBe('precache');
    expect(fake.calls).toHaveLength(0);
    expect(r.scores).toEqual(first.scores);
  });
});

describe('precache blob', () => {
  it('round-trips and exposes the maps', () => {
    const dec = decodePrecache(encodePrecache(precacheData()));
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.precache.chipEntityId('a1')).toBe(entity('Synthetic Singer', 'artist').id);
    expect(dec.precache.candidateEntityId('series_six')).toBeNull();
    expect(dec.precache.candidateEntityId('unknown')).toBeUndefined();
  });

  it('rejects other schema versions, bad shapes and garbage with a reason', () => {
    const old = decodePrecache(encodePrecache(precacheData({ schemaVersion: 'old' })));
    expect(old).toMatchObject({ ok: false });
    expect((old as { reason: string }).reason).toContain(SCHEMA_VERSION);
    const shape = decodePrecache(encodePrecache({ ...precacheData(), entries: [{ key: 1 }] } as never));
    expect(shape.ok).toBe(false);
    expect(decodePrecache('not base64 gzip').ok).toBe(false);
  });

  it('env loader: missing is normal, broken is reported', () => {
    expect(loadPrecacheFromEnv({})).toEqual({ precache: null });
    const bad = loadPrecacheFromEnv({ PERKFIT_PRECACHE: 'zzz' });
    expect(bad.precache).toBeNull();
    expect(bad.error).toBeTruthy();
    expect(loadPrecacheFromEnv({ PERKFIT_PRECACHE: encodePrecache(precacheData()) }).precache?.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('key ignores order and case, and changes with age, gender or candidates', () => {
    const base = { age: '25_to_29', interestEntityIds: ['00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8000-00000000000B'] };
    const k = precacheKey(base, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
    expect(precacheKey({ ...base, interestEntityIds: [...base.interestEntityIds].reverse() }, ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'])).toBe(k);
    expect(precacheKey({ ...base, interestEntityIds: base.interestEntityIds.map((s) => s.toLowerCase()) }, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])).toBe(k);
    expect(precacheKey({ ...base, age: '30_to_34' }, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])).not.toBe(k);
    expect(precacheKey({ ...base, gender: 'male' }, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])).not.toBe(k);
    expect(precacheKey(base, ['00000000-0000-4000-8000-000000000001'])).not.toBe(k);
  });
});
