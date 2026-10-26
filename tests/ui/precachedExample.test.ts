// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import type { RunRequest } from '@/lib/api/types';
import { isPrecachedExample } from '@/lib/ui/serverSeams';

const base = (): RunRequest => ({
  mode: 'live', segment: structuredClone(EXAMPLE_SEGMENTS[0]) as RunRequest['segment'], candidateOverrides: {},
  budget: DEFAULT_BUDGET, members: DEFAULT_MEMBERS, includeLlm: true,
});

describe('isPrecachedExample', () => {
  it('is true for an untouched example at default inputs', () => {
    expect(isPrecachedExample(base())).toBe(true);
    expect(isPrecachedExample({ ...base(), usage: { high: 0.45, mid: 0.25, low: 0.1 }, domainWeights: { place: 1 } })).toBe(true);
  });
  it('is false as soon as anything that could cause a Qloo or LLM call changes, even with an example id', () => {
    const changedChip = base();
    changedChip.segment.interests[0] = { token: 'c_someone-else', name: 'Fleabag' };
    expect(isPrecachedExample(changedChip)).toBe(false);
    const fewerChips = base();
    fewerChips.segment.interests.pop();
    expect(isPrecachedExample(fewerChips)).toBe(false);
    expect(isPrecachedExample({ ...base(), segment: { ...base().segment, age: '30_to_34' } })).toBe(false);
    expect(isPrecachedExample({ ...base(), budget: DEFAULT_BUDGET + 1 })).toBe(false);
    expect(isPrecachedExample({ ...base(), candidateOverrides: { katz: { unitCost: 9, billing: 'per_use', friction: 1 } } })).toBe(false);
    expect(isPrecachedExample({ ...base(), usage: { high: 0.5, mid: 0.25, low: 0.1 } })).toBe(false);
    expect(isPrecachedExample({ ...base(), domainWeights: { book: 0 } })).toBe(false);
    expect(isPrecachedExample({ ...base(), answers: { q1: 'x' } })).toBe(false);
    expect(isPrecachedExample({ ...base(), segment: { ...base().segment, id: 'custom' } })).toBe(false);
  });
});
