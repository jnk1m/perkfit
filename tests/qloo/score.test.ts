import { describe, expect, it, vi } from 'vitest';
import { createFakeQloo, entity } from '../helpers/fake-qloo';
import { CANDIDATE_MAP, SEG_A, TEST_CANDIDATES, makeService } from './_world';

vi.mock('server-only', () => ({}));

const by = (scores: { candidateId: string }[], id: string) => scores.find((s) => s.candidateId === id) as ReturnType<typeof Object>;

describe('scoreDomain', () => {
  it('place: omitted candidate is not_returned and nothing is filled in', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const r = await svc.scoreDomain('place', SEG_A, TEST_CANDIDATES, ctx);
    expect(r.envelope.code).toBe('ok');
    expect(r.scores).toHaveLength(5);
    const missing = by(r.scores, 'test_smokehouse');
    expect(missing).toMatchObject({ status: 'no_data', reason: 'not_returned', affinity: null, popularity: null, explain: [] });
    for (const id of ['harbor_deli', 'corner_pizza', 'demo_burger', 'sample_bakery']) {
      const s = by(r.scores, id);
      expect(s.status).toBe('ok');
      expect(s.affinity).toBeGreaterThan(0);
      expect(s.affinity).toBeLessThan(1);
      // explain is keyed by the chip tokens of this segment
      expect(s.explain.map((e: { token: string }) => e.token).sort()).toEqual(['a1', 'a2', 'a3']);
    }
    expect(ctx.stats).toMatchObject({ networkCalls: 1, noData: 1, noMatch: 0 });
    expect(r.callSummary.params['signal.interests.entities']).toBe('chip#1,chip#2,chip#3');
    expect(JSON.stringify(r.callSummary)).not.toMatch(/[0-9A-F]{8}-[0-9A-F]{4}/i);
  });

  it('tv_show: a no_match candidate is left out of the call', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const r = await svc.scoreDomain('tv_show', SEG_A, TEST_CANDIDATES, ctx);
    expect(by(r.scores, 'series_six')).toMatchObject({ status: 'no_match', reason: 'no_match', affinity: null });
    expect(fake.calls).toHaveLength(1);
    const sent = fake.calls[0].params['filter.results.entities'];
    expect(sent.split(',')).toHaveLength(4);
    expect(sent).not.toContain(entity('Demo Series Six', 'tv_show').id);
    expect(ctx.stats.noMatch).toBe(1);
  });

  it('book: missing or out-of-range affinity becomes no_affinity for that candidate only', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const r = await svc.scoreDomain('book', SEG_A, TEST_CANDIDATES, ctx);
    expect(r.envelope.code).toBe('ok');
    expect(by(r.scores, 'mock_almanac')).toMatchObject({ status: 'no_data', reason: 'no_affinity', affinity: null });
    expect(by(r.scores, 'test_handbook')).toMatchObject({ status: 'no_data', reason: 'no_affinity', affinity: null });
    expect(by(r.scores, 'placeholder_atlas').status).toBe('ok');
    expect(by(r.scores, 'sample_memoir').status).toBe('ok');
    expect(ctx.stats.noData).toBe(2);
  });

  it('all candidates without affinity: envelope no_signal', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const only = TEST_CANDIDATES.filter((c) => c.id === 'mock_almanac');
    const r = await svc.scoreDomain('book', SEG_A, only, ctx);
    expect(r.envelope.code).toBe('no_signal');
    expect(r.scores[0]).toMatchObject({ status: 'no_data', reason: 'no_affinity' });
  });

  it('scoreSegment runs four domains and keeps candidate order', async () => {
    const fake = createFakeQloo({ perSecondLimit: 99 });
    const svc = makeService(fake);
    const ctx = svc.createRunContext();
    const all = await svc.scoreSegment(SEG_A, TEST_CANDIDATES, ctx);
    expect(fake.calls).toHaveLength(4);
    expect(all.brand.scores.map((s) => s.candidateId)).toEqual(TEST_CANDIDATES.filter((c) => c.domain === 'brand').map((c) => c.id));
    expect(Object.keys(CANDIDATE_MAP)).toHaveLength(20);
  });
});
