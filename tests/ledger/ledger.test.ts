import { describe, expect, it } from 'vitest';
import { runEngine } from '@/lib/engine';
import { Ledger, LedgerError, buildCandidateFacts, fmtValue, qlooEntriesFromDomainResults } from '@/lib/ledger';
import { CANDIDATES, DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import type { LedgerEntry } from '@/lib/types';
import { DOMAINS } from '@/lib/types';
import { makeFakePort } from '../agent/helpers';

const entry = (over: Partial<LedgerEntry> & { id: string }): Omit<LedgerEntry, 'seq'> => ({
  source: 'qloo',
  field: 'x',
  value: 1,
  ...over,
});

describe('Ledger', () => {
  it('T15: a duplicate id throws, with the id in the message', () => {
    const l = new Ledger();
    l.add(entry({ id: 'qloo.affinity.a' }));
    expect(() => l.add(entry({ id: 'qloo.affinity.a' }))).toThrow(LedgerError);
    expect(() => l.add(entry({ id: 'qloo.affinity.a' }))).toThrow(/qloo\.affinity\.a/);
  });

  it('numbers entries in creation order and ignores a caller-supplied seq', () => {
    const l = new Ledger();
    l.add({ ...entry({ id: 'a' }), seq: 99 });
    l.add(entry({ id: 'b' }));
    expect(l.toJSON().map((e) => [e.id, e.seq])).toEqual([['a', 1], ['b', 2]]);
  });

  it('requires dependsOn on calc entries', () => {
    const l = new Ledger();
    expect(() => l.add(entry({ id: 'calc.p.a', source: 'calc' }))).toThrow(/dependsOn/);
  });

  it('forCandidate returns that candidate in seq order; forRun returns the rest', () => {
    const l = new Ledger();
    l.add(entry({ id: 'g1' }));
    l.add(entry({ id: 'a1', candidateId: 'a' }));
    l.add(entry({ id: 'b1', candidateId: 'b' }));
    l.add(entry({ id: 'a2', candidateId: 'a' }));
    expect(l.forCandidate('a').map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(l.forRun().map((e) => e.id)).toEqual(['g1']);
  });

  it('T5: isAssumed is true for an assumption and for anything that depends on one, recursively', () => {
    const l = new Ledger();
    l.add(entry({ id: 'qloo.affinity.a', candidateId: 'a' }));
    l.add(entry({ id: 'assume.rate.run', source: 'assumption' }));
    l.add(entry({ id: 'calc.pct.a', source: 'calc', dependsOn: ['qloo.affinity.a'] }));
    l.add(entry({ id: 'calc.use.a', source: 'calc', dependsOn: ['calc.pct.a', 'assume.rate.run'] }));
    l.add(entry({ id: 'calc.cost.a', source: 'calc', dependsOn: ['calc.use.a'] }));
    expect(l.isAssumed('qloo.affinity.a')).toBe(false);
    expect(l.isAssumed('calc.pct.a')).toBe(false);
    expect(l.isAssumed('assume.rate.run')).toBe(true);
    expect(l.isAssumed('calc.use.a')).toBe(true);
    expect(l.isAssumed('calc.cost.a')).toBe(true);
    expect(l.isAssumed('missing')).toBe(false);
  });

  it('merge puts Qloo entries first and engine entries after, renumbered', () => {
    const qloo: LedgerEntry[] = [{ ...entry({ id: 'qloo.a' }), seq: 1 }, { ...entry({ id: 'qloo.b' }), seq: 2 }];
    const engine: LedgerEntry[] = [{ ...entry({ id: 'assume.x', source: 'assumption' }), seq: 1 }];
    const l = Ledger.merge(qloo, engine);
    expect(l.toJSON().map((e) => [e.id, e.seq])).toEqual([['qloo.a', 1], ['qloo.b', 2], ['assume.x', 3]]);
  });
});

describe('fmt', () => {
  it('formats percentile, usage rate and money', () => {
    expect(fmtValue('percentile', 0.8333)).toBe('83rd percentile');
    expect(fmtValue('percentile', 0.5)).toBe('50th percentile');
    expect(fmtValue('percentile', 0.1167)).toBe('12th percentile');
    expect(fmtValue('percentile', 0.2133)).toBe('21st percentile');
    expect(fmtValue('usage_rate', 0.45)).toBe('45%');
    expect(fmtValue('monthly_cost', 1200)).toBe('$1,200');
    expect(fmtValue('stability', 2)).toBe('2 of 3 scenarios');
    expect(fmtValue('fit_tier', 'high')).toBe('high');
  });

  it('throws on a non-numeric value for a numeric field instead of printing NaN', () => {
    expect(() => fmtValue('percentile', 'abc')).toThrow(/finite number/);
  });
});

describe('ledger built from a real engine run', () => {
  async function build() {
    const port = makeFakePort();
    const ctx = port.createRunContext(10_000);
    const seg = EXAMPLE_SEGMENTS[0];
    const results = await Promise.all(DOMAINS.map((d) => port.scoreDomain(d, seg, [...CANDIDATES], ctx)));
    const scores = results.flatMap((r) => r.scores);
    const input = { segment: seg, candidates: [...CANDIDATES], budget: DEFAULT_BUDGET, members: DEFAULT_MEMBERS };
    const run = runEngine(input, scores);
    const qloo = qlooEntriesFromDomainResults(results, seg, CANDIDATES);
    return { ledger: Ledger.merge(qloo, run.ledger), run, qloo };
  }

  it('qloo entries never contain entity ids and use chip ordinals', async () => {
    const { qloo } = await build();
    const text = JSON.stringify(qloo);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(qloo.some((e) => e.id.startsWith('qloo.explain.') && /\.c[1-3]$/.test(e.id))).toBe(true);
    expect(qloo.find((e) => e.id === 'qloo.match.katz')?.value).toBe('ok');
  });

  it('builds a fact table whose source flags follow the dependency chain', async () => {
    const { ledger } = await build();
    const katz = CANDIDATES.find((c) => c.id === 'katz')!;
    const facts = buildCandidateFacts(ledger, katz)!;
    expect(facts.tier).toMatch(/high|mid|low/);
    const by = Object.fromEntries(facts.facts.map((f) => [f.key, f]));
    expect(by.f1.assumed).toBe(false); // percentile comes from Qloo ranks
    expect(by.f1.display).toMatch(/percentile$/);
    expect(by.f2.assumed).toBe(true); // usage rate rests on assumptions
    expect(by.f2.display).toMatch(/%$/);
    expect(by.f3.assumed).toBe(true);
    expect(by.f3.display).toMatch(/^\$/);
  });

  it('returns null for a candidate the ledger never scored', async () => {
    const port = makeFakePort({ noData: { katz: 'no_match' } });
    const ctx = port.createRunContext(10_000);
    const seg = EXAMPLE_SEGMENTS[0];
    const results = await Promise.all(DOMAINS.map((d) => port.scoreDomain(d, seg, [...CANDIDATES], ctx)));
    const run = runEngine({ segment: seg, candidates: [...CANDIDATES], budget: DEFAULT_BUDGET, members: DEFAULT_MEMBERS }, results.flatMap((r) => r.scores));
    const ledger = Ledger.merge(qlooEntriesFromDomainResults(results, seg, CANDIDATES), run.ledger);
    expect(buildCandidateFacts(ledger, CANDIDATES.find((c) => c.id === 'katz')!)).toBeNull();
    expect(ledger.get('qloo.match.katz')?.value).toBe('no_match');
    expect(ledger.get('qloo.status.katz')?.value).toBe('no_data');
  });
});
