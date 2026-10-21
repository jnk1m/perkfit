import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPacer } from '@/lib/qloo/pacer';
import { createQlooClient } from '@/lib/qloo/client';
import { createFakeQloo, entity } from '../helpers/fake-qloo';

vi.mock('server-only', () => ({}));

afterEach(() => vi.useRealTimers());

describe('pacing', () => {
  it('starts are at least 500 ms apart and at most 2 run at once', async () => {
    vi.useFakeTimers();
    const pacer = createPacer({ intervalMs: 500, concurrency: 2 });
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    const jobs = Array.from({ length: 8 }, () =>
      pacer.run(async () => {
        starts.push(Date.now());
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1_200));
        active--;
      }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all(jobs);
    expect(starts).toHaveLength(8);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('a paced client never trips the fake 3-per-second limit', async () => {
    vi.useFakeTimers();
    const fake = createFakeQloo();
    const client = createQlooClient({ transport: fake.transport });
    const q = {
      type: 'place' as const,
      interestEntityIds: [entity('Synthetic Singer', 'artist').id],
      age: '25_to_29' as const,
      candidateEntityIds: [entity('Harbor Deli', 'place').id],
    };
    const ctx = { deadlineAt: Date.now() + 60_000, stats: { networkCalls: 0, cacheHits: 0, retries: 0, noData: 0, noMatch: 0 }, consecutiveRateLimited: 0 };
    const all = Promise.all(Array.from({ length: 8 }, () => client.insights(q, ctx)));
    await vi.advanceTimersByTimeAsync(20_000);
    const results = await all;
    expect(results.every((r) => r.code === 'ok')).toBe(true);
    expect(fake.calls.every((c) => c.status === 200)).toBe(true);
    const at = fake.calls.map((c) => c.at);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(500);
  });
});
