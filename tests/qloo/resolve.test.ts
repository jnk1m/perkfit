import { describe, expect, it, vi } from 'vitest';
import { createFakeQloo, entity } from '../helpers/fake-qloo';
import { chipToken, entityIdFromChipToken, normalizeName, pickEntity } from '@/lib/qloo/resolve';
import { TEST_CANDIDATES, makeService } from './_world';

vi.mock('server-only', () => ({}));

const cand = (id: string) => TEST_CANDIDATES.find((c) => c.id === id)!;

describe('normalizeName', () => {
  it('folds case, apostrophes, punctuation and width', () => {
    expect(normalizeName("Katz’s  Delicatessen")).toBe('katzs delicatessen');
    expect(normalizeName('Russ & Daughters')).toBe('russ daughters');
    expect(normalizeName('Ｄune: Part Two')).toBe('dune part two');
  });
});

describe('resolveCandidate', () => {
  const run = async (id: string) => {
    const fake = createFakeQloo();
    const svc = makeService(fake);
    const out = await svc.resolveCandidate(cand(id), svc.createRunContext());
    return { out, fake, svc };
  };

  it('place: other-city namesake is dropped even when more popular; take is 10', async () => {
    const { out, fake } = await run('harbor_deli');
    expect(out.pick).toMatchObject({ kind: 'resolved', matchKind: 'exact' });
    if (out.pick.kind === 'resolved') expect(out.pick.entity.entityId).toBe(entity('Harbor Deli', 'place', 0).id);
    expect(fake.calls[0].params.take).toBe('10');
  });

  it('place: two popular branches in New York are ambiguous with options', async () => {
    const { out } = await run('corner_pizza');
    expect(out.pick.kind).toBe('ambiguous');
    if (out.pick.kind === 'ambiguous') {
      expect(out.pick.options).toHaveLength(2);
      expect(out.pick.options.map((o) => o.disambiguation)).toEqual(expect.arrayContaining(['Brooklyn branch', 'Queens branch']));
    }
  });

  it('book with a subtitle passes as a prefix match', async () => {
    const { out } = await run('placeholder_atlas');
    expect(out.pick).toMatchObject({ kind: 'resolved', matchKind: 'prefix' });
  });

  it('book name with an HTML entity matches after decoding', async () => {
    const { out } = await run('sample_memoir');
    expect(out.pick.kind).toBe('resolved');
    if (out.pick.kind === 'resolved') expect(out.pick.entity.name).toBe('Sample Memoir & Notes');
  });

  it('tv: a low-popularity namesake is ignored; only-low-popularity is no_match', async () => {
    const a = await run('series_three');
    expect(a.out.pick.kind).toBe('resolved');
    if (a.out.pick.kind === 'resolved') expect(a.out.pick.entity.entityId).toBe(entity('Demo Series Three', 'tv_show', 0).id);
    const b = await run('series_six');
    expect(b.out.pick.kind).toBe('no_match');
  });

  it('a resolved candidate is remembered for later scoring; a search failure is not', async () => {
    const fake = createFakeQloo();
    const svc = makeService(fake, { precache: null });
    const ctx = svc.createRunContext();
    await svc.resolveCandidate(cand('series_one'), ctx);
    const scored = await svc.scoreDomain('tv_show', { ...(await import('./_world')).SEG_A, interests: [{ token: chipToken(entity('Synthetic Drama', 'tv_show').id), name: 'x' }] }, [cand('series_one')], ctx);
    expect(scored.scores[0].status).toBe('ok');

    const fake2 = createFakeQloo();
    const svc2 = makeService(fake2, { precache: null });
    fake2.inject({ status: 503, times: 2 });
    const failed = await svc2.resolveCandidate(cand('series_two'), svc2.createRunContext());
    expect(failed.envelope.code).toBe('upstream');
    const again = await svc2.resolveCandidate(cand('series_two'), svc2.createRunContext());
    expect(again.pick.kind).toBe('resolved');
  });
});

describe('chip search and picking', () => {
  it('resolves a chip, ignoring a low-popularity namesake', async () => {
    const svc = makeService(createFakeQloo());
    const out = await svc.searchChip('Synthetic Singer', 'artist', svc.createRunContext());
    expect(out.pick.kind).toBe('resolved');
    if (out.pick.kind === 'resolved') expect(out.pick.entity.entityId).toBe(entity('Synthetic Singer', 'artist', 0).id);
  });

  it('null popularity ranks last', async () => {
    const svc = makeService(createFakeQloo());
    const out = await svc.searchChip('Demo Band', 'artist', svc.createRunContext());
    expect(out.envelope.data).toHaveLength(2);
    expect(out.pick.kind).toBe('resolved');
  });

  it('no results is no_match', async () => {
    const svc = makeService(createFakeQloo());
    const out = await svc.searchChip('Nothing Like This', 'artist', svc.createRunContext());
    expect(out.envelope.code).toBe('empty');
    expect(out.pick.kind).toBe('no_match');
  });

  it('pickEntity prefers an exact name over a more popular prefix', () => {
    const hit = (name: string, popularity: number) => ({ entityId: `00000000-0000-4000-8000-0000000000${popularity * 100}`, name, types: [], popularity });
    const r = pickEntity('Demo', [hit('Demo Sequel', 0.99), hit('Demo', 0.6)]);
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.entity.name).toBe('Demo');
  });
});

describe('chip token', () => {
  it('round-trips an entity id and rejects other strings', () => {
    const id = entity('Fake Folk Duo', 'artist').id;
    const t = chipToken(id);
    expect(t).not.toContain(id);
    expect(entityIdFromChipToken(t)).toBe(id);
    expect(entityIdFromChipToken('a1')).toBeUndefined();
    expect(entityIdFromChipToken('c_bm90LWEtdXVpZA')).toBeUndefined();
    expect(chipToken(id)).not.toContain(id.slice(0, 8));
  });
});
