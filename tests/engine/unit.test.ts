import { describe, expect, it } from 'vitest';
import {
  runEngine, EngineInputError, spearman, midRankPercentiles, tierOf, solveKnapsack, mergeConfig,
  configFromRequest, hashInputs, DEFAULT_CONFIG,
} from '@/lib/engine';
import type { Candidate, CandidateScore } from '@/lib/types';
import { cand, score, exampleInput, EXAMPLE_CANDIDATES, EXAMPLE_SCORES, SEGMENT, rng, shuffled } from './fixtures';

const inputOf = (candidates: Candidate[], budget = 250, extra = {}) => ({ segment: SEGMENT, candidates, budget, members: 100, ...extra });

describe('percentile tiers', () => {
  const expected: Record<number, [number, number, number]> = { 1: [0, 1, 0], 2: [1, 0, 1], 3: [1, 1, 1], 4: [1, 2, 1], 5: [2, 1, 2], 6: [2, 2, 2] };
  for (const n of [1, 2, 3, 4, 5, 6]) {
    it(`n=${n}`, () => {
      const cs = Array.from({ length: n }, (_, i) => cand(`C${i}`, `Name ${i}`, 'book', 1));
      const ss = cs.map((c, i) => score(c.id, 0.1 * (i + 1), 0.5));
      const r = runEngine(inputOf(cs, 10_000), ss);
      const count = (t: string) => r.perks.filter((p) => p.tier === t).length;
      expect([count('low'), count('mid'), count('high')]).toEqual(expected[n]);
      if (n <= 2) expect(r.warnings).toContainEqual({ code: 'thin_domain', domain: 'book' });
    });
  }
  it('ties share the mean rank and the same tier', () => {
    const { rank, p } = midRankPercentiles([0.5, 0.5, 0.9]);
    expect(rank).toEqual([1.5, 1.5, 3]);
    expect(p[0]).toBeCloseTo(1 / 3, 12);
    expect(tierOf(p[0], DEFAULT_CONFIG.cuts)).toBe('mid');
  });
});

describe('headline kinds', () => {
  it('same when every low-fit perk is in the bundle (budget is large)', () => {
    const r = runEngine(exampleInput({ budget: 10_000 }), EXAMPLE_SCORES);
    expect(r.headline).toMatchObject({ kind: 'same', n: 0, lowFitTotal: 2, text: expect.stringMatching(/^Fund these \d+ perks for \$[\d,]+ of \$10,000\/month$/) });
  });
  it('all_in when the baseline bundle avoids the low-fit perks too', () => {
    // P3 fixed cost becomes 500 (> budget), so the baseline skips it; baseline = P1, P2, B1 (230), B2 no longer fits.
    const cs = EXAMPLE_CANDIDATES.map((c) => (c.id === 'P3' ? { ...c, unitCost: 5 } : c));
    const r = runEngine(exampleInput({ candidates: cs }), EXAMPLE_SCORES);
    expect(r.baseline.perkIds).toEqual(['B1', 'P1', 'P2']);
    expect(r.headline).toMatchObject({ kind: 'all_in', n: 2, lowFitTotal: 2, skippedIds: ['B2', 'P3'], saveBase: 0 });
    expect(r.headline.subtitle).toBe(`Picking by popularity would swap ${r.headline.swapCount} of them; it also avoids the 2 low-fit perks.`);
  });
  it('same when there is no low-fit perk', () => {
    const r = runEngine(inputOf([cand('A', 'A', 'place', 1)]), [score('A', 0.5, 0.5)]);
    expect(r.headline).toMatchObject({ kind: 'same', lowFitTotal: 0, n: 0 });
  });
  it('skip_small when the saving is under 1% of the budget', () => {
    // place weight 0 keeps P3 out of the bundle; its fixed cost 0.01*100 = 1 < 2.5. B2 (low) is in the bundle,
    // but the baseline (P3 first by popularity, then P1, P2, B2) also holds B2, so X = 1 + 50 -> not small.
    // Make B2 unaffordable for the baseline instead: budget 3 would be below the unit, so use a tiny B2 cost.
    const cs = EXAMPLE_CANDIDATES.map((c) => (c.id === 'P3' ? { ...c, unitCost: 0.01 } : c.id === 'B2' ? { ...c, unitCost: 0.01 } : c));
    const r = runEngine(exampleInput({ candidates: cs, domainWeights: { place: 0 } }), EXAMPLE_SCORES);
    expect(r.headline).toMatchObject({ kind: 'skip_small', n: 1, lowFitTotal: 2, skippedIds: ['P3'] });
    expect(r.headline.saveBase).toBeLessThan(2.5);
    expect(r.headline.subtitle).toMatch(/^Picking by popularity would swap \d+ of them and put about \$\d+ into perks with low taste fit for this segment \(range \$\d+ to \$\d+\)\.$/);
  });
  it('insufficient when nothing is scored', () => {
    const r = runEngine(exampleInput(), EXAMPLE_CANDIDATES.map((c) => score(c.id, null, null, 'no_data')));
    expect(r.headline.kind).toBe('insufficient');
    expect(r.headline.text).toBe('Not enough Qloo data to judge (0 of 6 candidates scored)');
    expect(r.bundle.byScenario.base.perkIds).toEqual([]);
    expect(r.bundle.stability).toBeNull();
    expect(r.sensitivity.retained).toBeNull();
    expect(r.deferred).toHaveLength(6);
  });
  it('insufficient when the bundle is empty because the budget is below every cost', () => {
    const r = runEngine(exampleInput({ budget: 5 }), EXAMPLE_SCORES);
    expect(r.headline.kind).toBe('insufficient');
    expect(r.headline.text).toBe('No perk fits a $5/month budget');
    expect(r.headline.subtitle).toMatch(/^The cheapest scored perk costs about \$\d+\/month at assumed usage; 5 of 6 candidates were scored\.$/);
    expect(r.warnings).toContainEqual({ code: 'budget_below_unit' });
    expect(r.warnings.some((w) => w.code === 'over_budget_single')).toBe(true);
  });
  it('range is ordered low <= base <= high', () => {
    const r = runEngine(exampleInput(), EXAMPLE_SCORES);
    expect(r.headline.saveLow).toBeLessThanOrEqual(r.headline.saveBase);
    expect(r.headline.saveBase).toBeLessThanOrEqual(r.headline.saveHigh);
    expect(r.headline.saveBase).toBeLessThanOrEqual(r.budget);
  });
});

describe('edge cases', () => {
  it('zero-cost perk with value is always included', () => {
    const r = runEngine(inputOf([cand('A', 'A', 'place', 0), cand('B', 'B', 'place', 5)], 5), [score('A', 0.9, 0.5), score('B', 0.1, 0.5)]);
    expect(r.bundle.byScenario.base.perkIds).toEqual(['A']);
    expect(r.warnings).toContainEqual({ code: 'zero_cost', ids: ['A'] });
    expect(r.warnings).toContainEqual({ code: 'budget_below_unit' });
  });
  it('single perk over budget is excluded with a warning', () => {
    const r = runEngine(inputOf([cand('A', 'A', 'place', 1000), cand('B', 'B', 'place', 1)]), [score('A', 0.9, 0.5), score('B', 0.1, 0.5)]);
    expect(r.bundle.byScenario.base.perkIds).toEqual(['B']);
    expect(r.warnings).toContainEqual({ code: 'over_budget_single', ids: ['A'] });
  });
  it('friction 0 gives usage 0 and the perk is never chosen', () => {
    const r = runEngine(inputOf([cand('A', 'A', 'place', 5, 'per_use', 0), cand('B', 'B', 'place', 1)]), [score('A', 0.9, 0.5), score('B', 0.1, 0.4)]);
    expect(r.perks.find((p) => p.candidateId === 'A')?.scn.base.usageRate).toBe(0);
    expect(r.bundle.byScenario.base.perkIds).toEqual(['B']);
  });
  it('a huge budget does not blow up the search', () => {
    const r = runEngine(exampleInput({ budget: 1e9 }), EXAMPLE_SCORES);
    expect(r.bundle.byScenario.base.perkIds).toHaveLength(5);
  });
  it('tier usage from the config drives costs', () => {
    const r = runEngine(exampleInput(), EXAMPLE_SCORES, configFromRequest({ usage: { high: 0.5, mid: 0.25, low: 0.1 } }));
    expect(r.perks.find((p) => p.candidateId === 'P1')?.scn.base.monthlyCost).toBeCloseTo(50, 9);
  });
});

describe('spearman', () => {
  it('known values and null cases', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(spearman([], [])).toBeNull();
  });
});

describe('validation', () => {
  const bad = (input: ReturnType<typeof exampleInput>, field: string, scores: CandidateScore[] = EXAMPLE_SCORES) => {
    let err: unknown;
    try { runEngine(input, scores); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(EngineInputError);
    expect((err as EngineInputError).field).toContain(field);
    expect((err as EngineInputError).message).toContain('got');
  };
  it('rejects bad values with context', () => {
    bad(exampleInput({ candidates: [cand('P1', 'x', 'place', -1)] }), 'unitCost', []);
    bad(exampleInput({ candidates: [cand('P1', 'x', 'place', 1), cand('P1', 'y', 'place', 1)] }), 'candidates.id', []);
    bad(exampleInput({ members: 0 }), 'members');
    bad(exampleInput({ members: 1.5 }), 'members');
    bad(exampleInput({ budget: 0 }), 'budget');
    bad(exampleInput({ candidates: [cand('P1', 'x', 'place', 1, 'per_use', -1)] }), 'friction', []);
    bad(exampleInput({ domainWeights: { place: -1 } }), 'domainWeights');
    bad(exampleInput(), 'scores.candidateId', [...EXAMPLE_SCORES, score('NOPE', 0.1, 0.1)]);
    bad(exampleInput(), 'scores.candidateId', [...EXAMPLE_SCORES, score('P1', 0.1, 0.1)]);
  });
  it('rejects bad config', () => {
    expect(() => mergeConfig({ tierUsage: { high: 2, mid: 0.2, low: 0.1 } })).toThrow(EngineInputError);
    expect(() => mergeConfig({ cuts: { low: 0.8, high: 0.2 } })).toThrow(EngineInputError);
    expect(() => mergeConfig({ quantUnit: 0 })).toThrow(EngineInputError);
  });
});

describe('determinism', () => {
  it('shuffled candidates and scores give identical output, ties included', () => {
    const cs = [
      cand('a', 'Same Name', 'place', 3), cand('b', 'Same Name', 'place', 3), cand('c', 'Other', 'place', 3, 'fixed'),
      cand('d', 'D', 'brand', 4), cand('e', 'E', 'brand', 4), cand('f', 'F', 'book', 2), cand('g', 'G', 'tv_show', 2, 'fixed'),
    ];
    const ss = [score('a', 0.5, 0.9), score('b', 0.5, 0.9), score('c', 0.4, 0.9), score('d', 0.7, 0.8), score('e', 0.7, 0.8), score('f', 0.3, 0.1), score('g', 0.2, 0.2)];
    const base = runEngine(inputOf(cs, 120), ss);
    const r = rng(7);
    for (let i = 0; i < 20; i++) {
      expect(runEngine(inputOf(shuffled(cs, r), 120), shuffled(ss, r))).toEqual(base);
    }
  });
});

describe('seeded random: bundles never exceed the budget, and the search is optimal', () => {
  const r = rng(20261023);
  const domains = ['place', 'tv_show', 'brand', 'book'] as const;
  for (let t = 0; t < 200; t++) {
    it(`case ${t}`, () => {
      const n = 3 + Math.floor(r() * 18);
      const cs: Candidate[] = [];
      const ss: CandidateScore[] = [];
      for (let i = 0; i < n; i++) {
        const id = `c${String(i).padStart(2, '0')}`;
        cs.push(cand(id, `N${Math.floor(r() * 5)}`, domains[Math.floor(r() * 4)], Math.round(r() * 200) / 10, r() < 0.3 ? 'fixed' : 'per_use', r() < 0.2 ? 0.5 + r() : 1));
        const roll = r();
        ss.push(roll < 0.1 ? score(id, null, null, 'no_data') : score(id, Math.round(r() * 5) / 5, Math.round(r() * 3) / 3));
      }
      const budget = 5 + Math.floor(r() * 3000);
      const res = runEngine(inputOf(cs, budget, { members: 1 + Math.floor(r() * 400) }), ss);
      for (const b of [...Object.values(res.bundle.byScenario), res.baseline]) {
        expect(b.totalCost).toBeLessThanOrEqual(budget + 1e-6);
      }
      expect(res.headline.n).toBeLessThanOrEqual(res.headline.lowFitTotal);
      expect(res.headline.saveLow).toBeLessThanOrEqual(res.headline.saveBase + 1e-9);
      expect(res.headline.saveBase).toBeLessThanOrEqual(res.headline.saveHigh + 1e-9);
      expect(res.headline.saveFixedPart).toBeLessThanOrEqual(res.headline.saveBase + 1e-9);
    });
  }
  it('matches brute force on small instances', () => {
    const rr = rng(99);
    for (let t = 0; t < 100; t++) {
      const n = 2 + Math.floor(rr() * 7);
      const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, cost: Math.round(rr() * 90), value: Math.round(rr() * 100) / 10 }));
      const budget = 20 + Math.floor(rr() * 150);
      const got = solveKnapsack(items, budget, 10);
      const Q = Math.floor(budget / 10);
      let best = 0;
      for (let m = 0; m < 1 << n; m++) {
        let q = 0, v = 0;
        for (let i = 0; i < n; i++) if (m & (1 << i)) { q += Math.ceil(items[i].cost / 10); v += items[i].value; }
        if (q <= Q) best = Math.max(best, v);
      }
      const gotV = items.filter((x) => got.ids.includes(x.id)).reduce((s, x) => s + x.value, 0);
      expect(gotV).toBeCloseTo(best, 9);
    }
  });
});

describe('hashInputs', () => {
  it('is stable, order independent and sensitive to every editable value', () => {
    const h = hashInputs(exampleInput(), {});
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashInputs(exampleInput({ candidates: [...EXAMPLE_CANDIDATES].reverse() }), {})).toBe(h);
    expect(hashInputs(exampleInput(), undefined)).toBe(h);
    expect(hashInputs(exampleInput({ budget: 251 }), {})).not.toBe(h);
    expect(hashInputs(exampleInput({ members: 101 }), {})).not.toBe(h);
    expect(hashInputs(exampleInput({ domainWeights: { place: 1.5 } }), {})).not.toBe(h);
    expect(hashInputs(exampleInput({ domainWeights: { place: 1 } }), {})).toBe(h);
    expect(hashInputs(exampleInput({ candidates: EXAMPLE_CANDIDATES.map((c) => (c.id === 'P1' ? { ...c, friction: 1.1 } : c)) }), {})).not.toBe(h);
    expect(hashInputs(exampleInput(), { tierUsage: { high: 0.46, mid: 0.25, low: 0.1 } })).not.toBe(h);
    expect(hashInputs(exampleInput(), { cuts: { low: 0.3, high: 0.7 } })).not.toBe(h);
  });
});

describe('configFromRequest', () => {
  it('moves usage into a config and ignores an absent one', () => {
    expect(configFromRequest({})).toEqual({});
    expect(configFromRequest({ usage: { high: 0.5, mid: 0.3, low: 0.2 } })).toEqual({ tierUsage: { high: 0.5, mid: 0.3, low: 0.2 } });
  });
});
