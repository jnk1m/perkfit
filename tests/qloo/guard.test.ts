import { describe, expect, it, vi } from 'vitest';
import { createFakeQloo, entity, fakeHandler, FAKE_KEY } from '../helpers/fake-qloo';
import { guardInsights } from '@/lib/qloo/guard';
import { SEG_A, TEST_CANDIDATES, makeService } from './_world';
import type { InsightsQuery } from '@/lib/qloo/types';

vi.mock('server-only', () => ({}));

const valid = (): InsightsQuery => ({
  type: 'place',
  interestEntityIds: [entity('Synthetic Singer', 'artist').id],
  age: '25_to_29',
  candidateEntityIds: [entity('Harbor Deli', 'place').id],
});

describe('guard and empty results', () => {
  it('rejects bad queries before the network', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const bad: InsightsQuery[] = [
      { ...valid(), age: 'banana' as never },
      { ...valid(), interestEntityIds: [] },
      { ...valid(), interestEntityIds: ['not-a-uuid'] },
      { ...valid(), candidateEntityIds: [] },
      { ...valid(), type: 'movie' as never },
      { ...valid(), gender: 'other' as never },
      { ...valid(), interestEntityIds: Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000009${i}`) },
    ];
    for (const q of bad) {
      const env = await svc.client.insights(q, ctx);
      expect(env.code).toBe('no_signal');
      expect(env.detail).toMatch(/^guard:/);
    }
    expect(fake.calls).toHaveLength(0);
    expect(ctx.stats.networkCalls).toBe(0);
  });

  it('builds only known parameters and dedupes ids', () => {
    const id = entity('Synthetic Singer', 'artist').id;
    const g = guardInsights({ ...valid(), interestEntityIds: [id, id.toLowerCase()], gender: 'female' });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(Object.keys(g.params).sort()).toEqual(
      ['feature.explainability', 'filter.results.entities', 'filter.type', 'signal.demographics.age', 'signal.demographics.gender', 'signal.interests.entities', 'take'].sort(),
    );
    expect(g.params['signal.interests.entities']).toBe(id);
    expect(g.params['filter.type']).toBe('urn:entity:place');
  });

  it('the fake reproduces the trap: unknown parameter gives 200 and nothing', () => {
    const res = fakeHandler(
      { path: '/v2/insights', apiKey: FAKE_KEY, params: { 'filter.type': 'urn:entity:place', 'signal.interests.entity': entity('Synthetic Singer', 'artist').id } },
    );
    expect(res.status).toBe(200);
    expect((res.body as { results: { entities: unknown[] } }).results.entities).toHaveLength(0);
  });

  it('a valid query with nothing to return is "empty", not an error', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const env = await svc.client.insights(
      { ...valid(), candidateEntityIds: ['00000000-0000-4000-8000-000000000099'] },
      ctx,
    );
    expect(env.code).toBe('empty');
    expect(env.detail).toContain('empty_valid');
    expect(fake.calls).toHaveLength(1);
  });

  it('a segment with an unknown chip token fails without a call', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const r = await svc.scoreDomain('place', { ...SEG_A, interests: [{ token: 'zz', name: 'x' }] }, TEST_CANDIDATES, ctx);
    expect(r.envelope.code).toBe('no_signal');
    expect(fake.calls).toHaveLength(0);
    expect(r.scores.every((s) => s.reason === 'domain_error')).toBe(true);
  });
});
