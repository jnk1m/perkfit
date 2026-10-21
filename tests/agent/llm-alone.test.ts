import { describe, expect, it } from 'vitest';
import { CANDIDATES } from '@/data/candidates';
import { EXAMPLE_SEGMENTS } from '@/data/candidates';
import { LlmError } from '@/lib/llm/client';
import { LlmAloneCache, fillBudget, llmAloneHash, runLlmAlone } from '@/lib/llm/llm-alone';
import { FakeLlm } from '../helpers/fake-llm';

const cands = CANDIDATES.slice(0, 5).map((c) => ({ ...c }));
const costs = { katz: 400, joes_pizza: 300, shake_shack: 300, levain: 200, russ_daughters: 700 };
const input = { segment: EXAMPLE_SEGMENTS[0], candidates: cands, neutralCosts: costs, budget: 1000, members: 10_000 };
const base = { input, timeoutMs: () => 1000, gate: () => true };

describe('fillBudget', () => {
  it('T10: takes ids in order while the running cost fits and skips the ones that overflow', () => {
    const out = fillBudget(['katz', 'russ_daughters', 'joes_pizza', 'shake_shack', 'levain'], input);
    expect(out.bundleIds).toEqual(["katz", "joes_pizza", "shake_shack"]);
    expect(out.droppedOverBudget).toEqual(["russ_daughters", "levain"]);
    const total = out.bundleIds.reduce((a, id) => a + costs[id as keyof typeof costs], 0);
    expect(total).toBeLessThanOrEqual(input.budget);
  });

  it('T11: unknown and repeated ids are removed and counted', () => {
    const out = fillBudget(['katz', 'nope', 'katz', 'levain'], input);
    expect(out.bundleIds).toEqual(['katz', 'levain']);
    expect(out.unknownIds).toBe(2);
  });
});

describe('runLlmAlone', () => {
  it('uses the model order, never sends costs it did not get from code, and returns the filled bundle', async () => {
    const client = new FakeLlm([{ ranked: ['katz', 'russ_daughters', 'levain'] }]);
    const out = await runLlmAlone({ ...base, client, cache: new LlmAloneCache() });
    expect(out.bundleIds).toEqual(['katz', 'levain']);
    expect(out.droppedOverBudget).toEqual(['russ_daughters']);
    expect(out.cached).toBe(false);
    const prompt = JSON.parse(client.calls[0].prompt);
    expect(prompt.candidates[0]).toMatchObject({ id: 'katz', monthlyCost: 400 });
    expect(client.calls[0].maxOutputTokens).toBe(2000);
  });

  it('caches by input hash: the second identical call makes no LLM call', async () => {
    const cache = new LlmAloneCache();
    const client = new FakeLlm([{ ranked: ['katz'] }]);
    await runLlmAlone({ ...base, client, cache });
    const again = await runLlmAlone({ ...base, client, cache });
    expect(again.cached).toBe(true);
    expect(again.bundleIds).toEqual(['katz']);
    expect(client.calls).toHaveLength(1);
  });

  it('the cache is bounded and drops the oldest entry first', () => {
    const cache = new LlmAloneCache(2);
    const r = { bundleIds: [], droppedOverBudget: [], unknownIds: 0, cached: false, promptHash: 'x' };
    cache.set('a', r);
    cache.set('b', r);
    cache.set('c', r);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('the hash changes with the budget and with the model', () => {
    const a = llmAloneHash(input, 'm1');
    expect(llmAloneHash({ ...input, budget: 999 }, 'm1')).not.toBe(a);
    expect(llmAloneHash(input, 'm2')).not.toBe(a);
    expect(llmAloneHash(input, 'm1')).toBe(a);
  });

  it('an id outside the candidate list fails the schema instead of passing through', async () => {
    const client = new FakeLlm([{ ranked: ['katz', 'made_up'] }]);
    await expect(runLlmAlone({ ...base, client, cache: new LlmAloneCache() })).rejects.toBeInstanceOf(LlmError);
  });

  it('refuses to call when the run budget is spent', async () => {
    const client = new FakeLlm([{ ranked: [] }]);
    await expect(runLlmAlone({ ...base, client, gate: () => false, cache: new LlmAloneCache() })).rejects.toThrow(/budget/);
    expect(client.calls).toHaveLength(0);
  });
});
