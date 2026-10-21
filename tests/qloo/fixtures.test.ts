import { describe, expect, it, vi } from 'vitest';
import world from '../fixtures/synthetic/qloo/world.json';
import { FAKE_KEY, fakeHandler, type FixtureEntity } from '../helpers/fake-qloo';
import { CANDIDATE_MAP, CHIP_MAP, SEG_A, SEG_A2, SEG_B, TEST_CANDIDATES } from './_world';
import type { Domain, Segment } from '@/lib/types';

vi.mock('server-only', () => ({}));

const DOMAINS: Domain[] = ['place', 'tv_show', 'brand', 'book'];

function affinities(seg: Segment, domain: Domain): Map<string, number> {
  const ids = TEST_CANDIDATES.filter((c) => c.domain === domain)
    .map((c) => CANDIDATE_MAP[c.id])
    .filter((x): x is string => !!x);
  const res = fakeHandler({
    path: '/v2/insights',
    apiKey: FAKE_KEY,
    params: {
      'filter.type': `urn:entity:${domain}`,
      'signal.interests.entities': seg.interests.map((i) => CHIP_MAP[i.token]).join(','),
      'signal.demographics.age': seg.age,
      'filter.results.entities': ids.join(','),
      'feature.explainability': 'true',
      take: String(ids.length),
    },
  });
  const rows = (res.body as { results: { entities: { entity_id: string; query: { affinity?: number } }[] } }).results.entities;
  return new Map(rows.filter((r) => typeof r.query.affinity === 'number' && r.query.affinity <= 1).map((r) => [r.entity_id, r.query.affinity!]));
}

function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

function corr(x: Segment, y: Segment, domain: Domain): number {
  const ax = affinities(x, domain);
  const ay = affinities(y, domain);
  const common = [...ax.keys()].filter((k) => ay.has(k));
  return spearman(common.map((k) => ax.get(k)!), common.map((k) => ay.get(k)!));
}

describe('synthetic fixtures', () => {
  it('are marked synthetic and use only fake ids', () => {
    expect((world as { _synthetic: boolean })._synthetic).toBe(true);
    for (const e of (world as { entities: FixtureEntity[] }).entities) expect(e.id).toMatch(/^00000000-0000-4000-8000-0000000000[0-9A-F]{2}$/i);
  });

  it('segments A and B differ strongly in every domain, A and A2 stay close', () => {
    for (const d of DOMAINS) {
      expect(corr(SEG_A, SEG_B, d), `A~B ${d}`).toBeLessThan(0.8);
      expect(corr(SEG_A, SEG_A2, d), `A~A2 ${d}`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('affinity order is not the popularity order', () => {
    for (const d of DOMAINS) {
      const a = affinities(SEG_A, d);
      const pop = new Map((world as { entities: FixtureEntity[] }).entities.map((e) => [e.id, e.popularity ?? 0]));
      const keys = [...a.keys()];
      expect(spearman(keys.map((k) => a.get(k)!), keys.map((k) => pop.get(k)!)), `A~popularity ${d}`).toBeLessThan(0.9);
    }
  });

  it('affinities stay inside 0..1 for ok candidates', () => {
    for (const seg of [SEG_A, SEG_B, SEG_A2]) for (const d of DOMAINS) for (const v of affinities(seg, d).values()) expect(v).toBeGreaterThan(0);
  });
});
