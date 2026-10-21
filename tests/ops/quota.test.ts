import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { checkQuota, LIMITS, type QuotaStore } from '@/lib/ops/quota';

function memoryStore() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const store: QuotaStore = {
    async incrby(key, amount) {
      const next = (counts.get(key) ?? 0) + amount;
      counts.set(key, next);
      return next;
    },
    async expire(key, seconds) {
      ttls.set(key, seconds);
      return 1;
    },
  };
  return { store, counts, ttls };
}

const day1 = new Date('2026-10-25T10:00:00Z');
const day2 = new Date('2026-10-26T00:00:01Z');

describe('checkQuota without a store', () => {
  it('refuses custom live runs and searches', async () => {
    for (const kind of ['qloo_run', 'search'] as const) {
      const r = await checkQuota(kind, '1.1.1.1', { store: null });
      expect(r).toMatchObject({ ok: false, error: { code: 'quota_exceeded' } });
    }
  });

  it('lets example runs through', async () => {
    expect(await checkQuota('qloo_run', '1.1.1.1', { store: null, example: true })).toEqual({ ok: true });
  });
});

describe('checkQuota with a store', () => {
  it('allows 10 live runs per address, then refuses the 11th', async () => {
    const { store } = memoryStore();
    for (let i = 0; i < LIMITS.liveRunsPerIpPerDay; i++) {
      const r = await checkQuota('qloo_run', '2.2.2.2', { store, now: day1 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.liveRunsLeft).toBe(LIMITS.liveRunsPerIpPerDay - i - 1);
    }
    const over = await checkQuota('qloo_run', '2.2.2.2', { store, now: day1 });
    expect(over).toMatchObject({ ok: false, error: { code: 'quota_exceeded' } });
    const other = await checkQuota('qloo_run', '3.3.3.3', { store, now: day1 });
    expect(other.ok).toBe(true);
  });

  it('resets on the next UTC day', async () => {
    const { store } = memoryStore();
    for (let i = 0; i <= LIMITS.liveRunsPerIpPerDay; i++) await checkQuota('qloo_run', '2.2.2.2', { store, now: day1 });
    expect((await checkQuota('qloo_run', '2.2.2.2', { store, now: day1 })).ok).toBe(false);
    expect((await checkQuota('qloo_run', '2.2.2.2', { store, now: day2 })).ok).toBe(true);
  });

  it('counts Qloo calls globally across addresses', async () => {
    const { store } = memoryStore();
    const first = await checkQuota('qloo_run', '4.4.4.4', { store, now: day1, qlooCalls: LIMITS.qlooCallsPerDay });
    expect(first.ok).toBe(true);
    const second = await checkQuota('qloo_run', '5.5.5.5', { store, now: day1, qlooCalls: 1 });
    expect(second).toMatchObject({ ok: false, error: { code: 'quota_exceeded' } });
  });

  it('limits LLM runs globally', async () => {
    const { store } = memoryStore();
    for (let i = 0; i < LIMITS.llmRunsPerDay; i++) {
      expect((await checkQuota('llm_run', `10.0.0.${i}`, { store, now: day1 })).ok).toBe(true);
    }
    expect((await checkQuota('llm_run', '9.9.9.9', { store, now: day1 })).ok).toBe(false);
  });

  it('limits searches per address and also counts them as Qloo calls', async () => {
    const { store, counts } = memoryStore();
    for (let i = 0; i < LIMITS.searchesPerIpPerDay; i++) {
      expect((await checkQuota('search', '6.6.6.6', { store, now: day1 })).ok).toBe(true);
    }
    expect((await checkQuota('search', '6.6.6.6', { store, now: day1 })).ok).toBe(false);
    expect(counts.get('perkfit:2026-10-25:qloo')).toBeGreaterThanOrEqual(LIMITS.searchesPerIpPerDay);
  });

  it('never passes example runs to the store', async () => {
    const { store, counts } = memoryStore();
    await checkQuota('qloo_run', '7.7.7.7', { store, now: day1, example: true });
    expect(counts.size).toBe(0);
  });

  it('sets an expiry on new counters and stores no raw address', async () => {
    const { store, counts, ttls } = memoryStore();
    await checkQuota('qloo_run', '8.8.8.8', { store, now: day1 });
    expect(ttls.size).toBe(2);
    for (const key of counts.keys()) expect(key).not.toContain('8.8.8.8');
  });

  it('fails closed when the store throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store: QuotaStore = {
      incrby: async () => {
        throw new Error('connection reset');
      },
      expire: async () => 1,
    };
    const r = await checkQuota('qloo_run', '1.2.3.4', { store, now: day1 });
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('connection reset'));
    error.mockRestore();
  });
});
