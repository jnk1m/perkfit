import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { EXAMPLE_SCORES, exampleInput } from './fixtures';

describe('engine ledger', () => {
  const run = runEngine(exampleInput(), EXAMPLE_SCORES);
  const byId = new Map(run.ledger.map((e) => [e.id, e]));

  it('ids are unique, follow the naming rule, and seq runs from 1', () => {
    expect(byId.size).toBe(run.ledger.length);
    run.ledger.forEach((e, i) => {
      expect(e.seq).toBe(i + 1);
      expect(e.id).toMatch(/^(calc|assume)\.[a-z_]+\.[A-Za-z0-9_]+(\.[a-z]+)?$/);
      expect(e.source === 'calc' ? e.id.startsWith('calc.') : e.id.startsWith('assume.')).toBe(true);
      expect(e.source === 'assumption' || e.source === 'calc').toBe(true);
    });
  });

  it('seqOffset appends after other entries', () => {
    const r = runEngine(exampleInput(), EXAMPLE_SCORES, undefined, { seqOffset: 40 });
    expect(r.ledger[0].seq).toBe(41);
    expect(r.ledger.at(-1)?.seq).toBe(40 + r.ledger.length);
  });

  it('every calc entry has dependsOn, and each dependency exists (or is a Qloo id)', () => {
    for (const e of run.ledger) {
      if (e.source !== 'calc') continue;
      expect(e.dependsOn?.length, e.id).toBeGreaterThan(0);
      for (const d of e.dependsOn ?? []) expect(byId.has(d) || d.startsWith('qloo.'), `${e.id} -> ${d}`).toBe(true);
    }
  });

  it('per-perk entries are base scenario only; optimistic and pessimistic are global', () => {
    for (const e of run.ledger) {
      if (e.candidateId && e.scenario) expect(e.scenario, e.id).toBe('base');
    }
    expect(byId.get('calc.bundle_cost.run.optimistic')?.value).toBe(225);
    expect(byId.get('calc.bundle_cost.run.pessimistic')?.value).toBe(210);
    expect(byId.get('calc.bundle_size.run.base')?.value).toBe(3);
  });

  it('spot values', () => {
    expect(byId.get('calc.percentile.P1')).toMatchObject({ value: 0.8333, note: 'rank 3 of 3 in place', source: 'calc' });
    expect(byId.get('calc.fit_tier.P3')?.value).toBe('low');
    expect(byId.get('calc.monthly_cost.B1')?.value).toBe(135);
    expect(byId.get('calc.headline_n.run')?.value).toBe(2);
    expect(byId.get('calc.headline_low_total.run')?.value).toBe(2);
    expect(byId.get('calc.headline_save.run.base')?.value).toBe(150);
    expect(byId.get('calc.headline_save.run.pessimistic')?.value).toBe(137.5);
    expect(byId.get('calc.headline_save.run.optimistic')?.value).toBe(162.5);
    expect(byId.get('calc.headline_save_fixed.run')?.value).toBe(100);
    expect(byId.get('calc.changed_vs_popularity.run')?.value).toBe('1 of 3');
    expect(byId.get('calc.spearman_vs_popularity.run')?.value).toBe(-0.4472);
    expect(byId.get('calc.stability_ratio.run')?.value).toBe(0.6667);
    expect(byId.get('calc.sensitivity_retained.run')?.value).toBe(1);
    expect(byId.get('calc.deferred_count.run')?.value).toBe(1);
    expect(byId.get('calc.skipped.P3')?.value).toBe(1);
    expect(byId.get('calc.stability.P2')?.value).toBe(2);
    expect(byId.get('assume.usage_rate_low.run')).toMatchObject({ source: 'assumption', value: 0.1 });
    expect(byId.get('assume.scenario_multiplier.run.optimistic')).toMatchObject({ value: 1.25, scenario: 'optimistic' });
    expect(byId.get('assume.billing.P3')?.value).toBe('fixed');
  });

  it('holds together for an empty result too', () => {
    const r = runEngine(exampleInput(), EXAMPLE_SCORES.map((s) => ({ ...s, status: 'no_data' as const, affinity: null })));
    const ids = new Map(r.ledger.map((e) => [e.id, e]));
    for (const e of r.ledger) {
      if (e.source === 'calc') {
        expect(e.dependsOn?.length, e.id).toBeGreaterThan(0);
        for (const d of e.dependsOn ?? []) expect(ids.has(d) || d.startsWith('qloo.'), `${e.id} -> ${d}`).toBe(true);
      }
    }
  });
});
