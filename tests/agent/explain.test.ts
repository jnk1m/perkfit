import { describe, expect, it } from 'vitest';
import type { CandidateFacts, Fact } from '@/lib/ledger';
import { LlmError } from '@/lib/llm/client';
import { applyTemplates, factSentence, runExplain } from '@/lib/llm/explain';
import { FakeLlm } from '../helpers/fake-llm';

const fact = (key: string, assumed: boolean, display: string): Fact => ({ key, label: key, field: key, entryId: key, source: 'calc', assumed, display });
const mk = (id: string, name: string, tier: 'high' | 'mid' | 'low'): CandidateFacts => ({
  candidateId: id,
  name,
  domain: 'place',
  tier,
  facts: [fact('f1', false, '83rd percentile'), fact('f2', true, '45%'), fact('f3', true, '$1,200')],
});
const targets = [mk('a', 'Alpha', 'high'), mk('b', 'Beta', 'mid'), mk('c', 'Gamma', 'low')];
const GOOD = '{name} sits at {f1} within {domain}, a {tier} taste fit. The {f3} monthly cost rests on an assumed usage rate of {f2}.';
const good = (t: CandidateFacts) => ({ candidateId: t.candidateId, tier: t.tier, text: GOOD });
const base = { segmentId: 'example_a', targets, timeoutMs: () => 5_000, gate: () => true };

describe('runExplain', () => {
  it('T14: passing templates are rendered with ledger values', async () => {
    const client = new FakeLlm([{ items: targets.map(good) }]);
    const out = await runExplain({ ...base, client });
    expect(out.llm).toBe('ok');
    expect(out.llmCalls).toBe(1);
    expect(out.stats).toMatchObject({ total: 3, passedFirst: 3, repaired: 0, discarded: 0 });
    expect(out.items[0]).toMatchObject({ candidateId: 'a', status: 'verified', failedRules: [] });
    expect(out.items[0].sentence).toBe('Alpha sits at 83rd percentile within place, a high taste fit. The $1,200 monthly cost rests on an assumed usage rate of 45%.');
    expect(out.templates).toHaveLength(3);
  });

  it('T9: a violation is retried once with rule ids only, and the repaired text passes', async () => {
    const bad = { candidateId: 'b', tier: 'mid', text: '{name} ranks at the 83 percentile in {domain}, a {tier} taste fit.' };
    const client = new FakeLlm([{ items: [good(targets[0]), bad, good(targets[2])] }, { items: [good(targets[1])] }]);
    const out = await runExplain({ ...base, client });
    expect(out.stats).toMatchObject({ total: 3, passedFirst: 2, repaired: 1, discarded: 0 });
    expect(out.items.map((i) => i.status)).toEqual(['verified', 'verified', 'verified']);
    expect(client.calls).toHaveLength(2);
    // The retry prompt names the failed perk and rule, and does not repeat the rejected text.
    const retry = JSON.parse(client.calls[1].prompt);
    expect(retry.perks.map((p: { candidateId: string }) => p.candidateId)).toEqual(['b']);
    expect(retry.perks[0].violations[0].rule).toBe('V4');
    expect(client.calls[1].prompt).not.toContain('83 percentile');
    expect(client.calls[1].purpose).toBe('explain_retry');
  });

  it('T12: when every template breaks a rule, every item is discarded and the rule ids are kept', async () => {
    const bad = (t: CandidateFacts) => ({ candidateId: t.candidateId, tier: t.tier, text: 'about 83 percent in {domain}' });
    const client = new FakeLlm([{ items: targets.map(bad) }, { items: targets.map(bad) }]);
    const out = await runExplain({ ...base, client });
    expect(out.llm).toBe('ok');
    expect(out.items.every((i) => i.sentence === null && i.status === 'discarded')).toBe(true);
    expect(out.items[0].failedRules).toEqual(expect.arrayContaining(['V3', 'V4']));
    expect(out.stats).toMatchObject({ total: 3, passedFirst: 0, repaired: 0, discarded: 3 });
    expect(out.stats.byRule.V4).toBe(3);
    expect(out.templates).toEqual([]);
  });

  it('T7: items for unknown ids are ignored; a missing target is V0', async () => {
    const stray = { candidateId: 'zzz', tier: 'high', text: GOOD };
    const client = new FakeLlm([{ items: [good(targets[0]), stray] }, { items: [] }]);
    const out = await runExplain({ ...base, client });
    expect(out.items[0].status).toBe('verified');
    expect(out.items[1]).toMatchObject({ candidateId: 'b', status: 'discarded', failedRules: ['V0'] });
    expect(out.items[2]).toMatchObject({ candidateId: 'c', status: 'discarded', failedRules: ['V0'] });
  });

  it('T13: a first-call failure yields code fact sentences and llm failed', async () => {
    const client = new FakeLlm([new LlmError('timeout', 'timed out')]);
    const out = await runExplain({ ...base, client });
    expect(out.llm).toBe('failed');
    expect(out.error).toMatch(/timed out/);
    expect(out.items.map((i) => i.sentence)).toEqual(['Alpha: high taste fit, 83rd percentile in its category.', 'Beta: mid taste fit, 83rd percentile in its category.', 'Gamma: low taste fit, 83rd percentile in its category.']);
    expect(out.items.every((i) => i.status === 'verified')).toBe(true);
    expect(out.templates).toEqual([]);
  });

  it('schema failure on the first call is also a failure, not a crash', async () => {
    const client = new FakeLlm([{ wrong: true }]);
    const out = await runExplain({ ...base, client });
    expect(out.llm).toBe('failed');
  });

  it('a failing retry keeps the first-pass verdict', async () => {
    const bad = { candidateId: 'b', tier: 'mid', text: 'no slots here' };
    const client = new FakeLlm([{ items: [good(targets[0]), bad, good(targets[2])] }, new LlmError('timeout', 'x')]);
    const out = await runExplain({ ...base, client });
    expect(out.stats).toMatchObject({ passedFirst: 2, repaired: 0, discarded: 1 });
    expect(out.items[1].sentence).toBeNull();
  });

  it('an exhausted LLM budget stops before the first call', async () => {
    const client = new FakeLlm([{ items: targets.map(good) }]);
    const out = await runExplain({ ...base, client, gate: () => false });
    expect(out.llm).toBe('failed');
    expect(client.calls).toHaveLength(0);
  });

  it('a spent budget on retry keeps the first pass', async () => {
    let n = 0;
    const bad = { candidateId: 'b', tier: 'mid', text: 'no slots here' };
    const client = new FakeLlm([{ items: [good(targets[0]), bad, good(targets[2])] }]);
    const out = await runExplain({ ...base, client, gate: () => ++n === 1 });
    expect(client.calls).toHaveLength(1);
    expect(out.stats.discarded).toBe(1);
  });

  it('sends only the segment id, never a label or chip name', async () => {
    const client = new FakeLlm([{ items: targets.map(good) }]);
    await runExplain({ ...base, client });
    expect(JSON.parse(client.calls[0].prompt).segment).toBe('example_a');
    expect(client.calls[0].system).toContain('slot');
  });
});

describe('applyTemplates', () => {
  it('re-validates stored templates against the current ledger', () => {
    const stale = { candidateId: 'a', tier: 'low' as const, text: GOOD }; // tier moved after an edit
    const { items, verified, missing } = applyTemplates(targets, [stale, { candidateId: 'b', tier: 'mid', text: GOOD }]);
    expect(items[0].sentence).toBe(factSentence(targets[0]));
    expect(items[1].sentence).toContain('Beta sits at 83rd percentile');
    expect(items[2].sentence).toBe(factSentence(targets[2]));
    expect(verified.map((v) => v.candidateId)).toEqual(['b']);
    expect(missing).toBe(1);
  });
});
