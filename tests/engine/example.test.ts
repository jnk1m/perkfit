import { describe, expect, it } from 'vitest';
import { runEngine, compareBundles, compareSegments, neutralCost } from '@/lib/engine';
import { EXAMPLE_CANDIDATES, EXAMPLE_SCORES, exampleInput, cand, score } from './fixtures';

const close = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('worked example (02 section 12)', () => {
  const run = runEngine(exampleInput(), EXAMPLE_SCORES);

  it('percentiles, tiers and base-scenario numbers', () => {
    const by = Object.fromEntries(run.perks.map((p) => [p.candidateId, p]));
    close(by.P1.percentile, 5 / 6);
    close(by.P2.percentile, 0.5);
    close(by.P3.percentile, 1 / 6);
    close(by.B1.percentile, 0.75);
    close(by.B2.percentile, 0.25);
    expect(Object.fromEntries(run.perks.map((p) => [p.candidateId, p.tier]))).toEqual({
      B1: 'high', B2: 'low', P1: 'high', P2: 'mid', P3: 'low',
    });
    const cost = (id: string) => by[id].scn.base.monthlyCost;
    close(cost('P1'), 45); close(cost('P2'), 50); close(cost('P3'), 100); close(cost('B1'), 135); close(cost('B2'), 50);
    close(by.P1.scn.base.value, 37.5); close(by.P2.scn.base.value, 12.5); close(by.P3.scn.base.value, 5 / 3);
    close(by.B1.scn.base.value, 33.75); close(by.B2.scn.base.value, 2.5);
    expect(run.deferred.map((d) => [d.candidateId, d.reason])).toEqual([['P4', 'no_data']]);
  });

  it('three scenario bundles', () => {
    const b = run.bundle.byScenario;
    expect(b.optimistic.perkIds).toEqual(['B1', 'P1']);
    close(b.optimistic.totalCost, 225); close(b.optimistic.totalValue, 89.0625);
    expect(b.base.perkIds).toEqual(['B1', 'P1', 'P2']);
    close(b.base.totalCost, 230); close(b.base.totalValue, 83.75);
    expect(b.pessimistic.perkIds).toEqual(['B1', 'B2', 'P1', 'P2']);
    close(b.pessimistic.totalCost, 210); close(b.pessimistic.totalValue, 64.6875);
    expect(run.bundle.stableIds).toEqual(['B1', 'P1']);
    close(run.bundle.stability as number, 2 / 3);
    expect(run.bundle.inScenarioCount).toEqual({ B1: 3, B2: 1, P1: 3, P2: 2, P3: 0 });
  });

  it('popularity-order baseline', () => {
    expect(run.baseline.perkIds).toEqual(['B2', 'P1', 'P2', 'P3']);
    close(run.baseline.totalCost, 245);
  });

  // Definition change (differs from 02 section 6 and DESIGN decision 4): N and skippedIds stay Qloo-only
  // (low tier, outside the base bundle) but the money is what the popularity baseline spends on low-fit perks.
  // Low = {P3, B2}, both outside the base bundle, so N = 2. Baseline {P1,P2,P3,B2} -> K = {P3, B2}.
  // X = 100 (P3 fixed) + 50 = 150, fixed part 100, pessimistic 100 + 37.5, optimistic 100 + 62.5.
  it('headline (hand-computed)', () => {
    const h = run.headline;
    expect(h.kind).toBe('skip');
    expect(h.n).toBe(2);
    expect(h.lowFitTotal).toBe(2);
    expect(h.skippedIds).toEqual(['B2', 'P3']);
    close(h.saveBase, 150); close(h.saveFixedPart, 100); close(h.saveLow, 137.5); close(h.saveHigh, 162.5);
    expect(h.text).toBe('Skip 2 low-fit perks');
    expect(h.subtitle).toBe('A popularity-ordered bundle would spend about $150 of $250 on 2 of them (range $138 to $163; fixed-fee $100)');
  });

  it('comparison with the popularity baseline', () => {
    const c = run.compare.vsPopularity;
    expect(c.diff).toEqual({ n: 1, m: 3, kept: ['P1', 'P2'], dropped: ['B1'], added: ['B2', 'P3'] });
    close(c.rho as number, -4 / Math.sqrt(80), 1e-9);
    expect(c.rhoN).toBe(5);
  });

  it('sensitivity retains the whole base bundle', () => {
    expect(run.sensitivity.retained).toBe(1);
    expect(run.sensitivity.variants.map((v) => v.retained)).toEqual([1, 1]);
    expect(run.sensitivity.variants[0].perkIds).toEqual(['B1', 'B2', 'P1', 'P2']);
    expect(run.sensitivity.variants[1].perkIds).toEqual(['B1', 'P1', 'P2']);
  });

  it('holdout rows follow the base bundle', () => {
    expect(run.holdout.map((h) => h.candidateId)).toEqual(['B1', 'P1', 'P2']);
    expect(run.holdout[0]).toMatchObject({ holdoutShare: 0.1, holdoutMembers: 10, weeks: 4, successRule: 'incremental ROI > 0' });
    expect(run.holdout[0].hypothesis).toContain('Test whether offering Echo Gear to Test segment changes usage');
  });

  it('warnings', () => {
    expect(run.warnings).toContainEqual({ code: 'thin_domain', domain: 'brand' });
    expect(run.warnings).toContainEqual({ code: 'popularity_ties', ids: ['B1', 'B2'] });
  });

  it('compareBundles prices unscored and flags unknown ids', () => {
    const r = compareBundles(run, ['P1', 'P4', 'ZZ', 'P3', 'P1']);
    expect(r.diff).toEqual({ n: 2, m: 3, kept: ['P1'], dropped: ['B1', 'P2'], added: ['P3', 'P4', 'ZZ'] });
    expect(r.eval.unscoredIds).toEqual(['P4']);
    expect(r.eval.unknownIds).toEqual(['ZZ']);
    expect(r.eval.lowFitIds).toEqual(['P3']);
    close(r.eval.cost, 45 + 100 + 25);
    expect(r.eval.withinBudget).toBe(true);
    expect(r.rho).toBeNull();
    const withScores = compareBundles(run, ['P1'], { P1: 5, P2: 4, P3: 1, B1: 3, B2: 2 });
    expect(withScores.rhoN).toBe(5);
    expect(withScores.rho).not.toBeNull();
  });

  it('compareSegments diffs bundles and correlates percentiles', () => {
    const other = runEngine(exampleInput({ budget: 120 }), EXAMPLE_SCORES);
    const c = compareSegments(run, other);
    expect(c.rhoN).toBe(5);
    close(c.rho as number, 1);
    expect(c.diff.m).toBe(3);
  });

  it('neutralCost uses the mid tier in the base scenario', () => {
    close(neutralCost(EXAMPLE_CANDIDATES[0], 100), 25);
    close(neutralCost(EXAMPLE_CANDIDATES[2], 100), 100);
    close(neutralCost(cand('X', 'X', 'place', 1, 'per_use', 2), 100), 50);
  });

  it('a no-data candidate changes nothing once removed', () => {
    const slim = runEngine(
      exampleInput({ candidates: EXAMPLE_CANDIDATES.filter((c) => c.id !== 'P4') }),
      EXAMPLE_SCORES.filter((s) => s.candidateId !== 'P4'),
    );
    for (const k of ['perks', 'bundle', 'baseline', 'headline', 'compare', 'sensitivity', 'holdout'] as const) {
      expect(slim[k]).toEqual(run[k]);
    }
  });

  it('a candidate with no score row is deferred with a warning', () => {
    const r = runEngine(exampleInput(), EXAMPLE_SCORES.filter((s) => s.candidateId !== 'B2'));
    expect(r.deferred.map((d) => d.candidateId)).toEqual(['B2', 'P4']);
    expect(r.warnings).toContainEqual({ code: 'missing_score', ids: ['B2'] });
    const r2 = runEngine(exampleInput(), [...EXAMPLE_SCORES.filter((s) => s.candidateId !== 'B2'), score('B2', null, 0.5, 'ok')]);
    expect(r2.warnings).toContainEqual({ code: 'ok_without_affinity', ids: ['B2'] });
    expect(r2.deferred.map((d) => d.candidateId)).toContain('B2');
  });
});
