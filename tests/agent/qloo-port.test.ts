import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createQlooPort } = await import('@/lib/agent/qloo-port');
const { chipToken, entityIdFromChipToken } = await import('@/lib/qloo/resolve');

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hit = (n: number, name: string, disambiguation?: string) => ({ entityId: ID(n), name, types: [], popularity: 0.9, disambiguation });
const ctx = { deadlineAt: Date.now() + 1000, stats: { networkCalls: 0, cacheHits: 0, retries: 0, noData: 0, noMatch: 0 }, consecutiveRateLimited: 0 };
const ok = { code: 'ok' as const, retryable: false, latencyMs: 1, source: 'network' as const };

function service(over: Record<string, unknown> = {}) {
  return {
    precache: { chipEntityId: (t: string) => (t === 'a1' ? ID(1) : undefined) },
    searchChip: vi.fn(async () => ({ envelope: ok, pick: { kind: 'no_match' } })),
    resolveCandidate: vi.fn(),
    scoreDomain: vi.fn(),
    ...over,
  } as never;
}

describe('createQlooPort.resolveChip', () => {
  it('a token the precache knows resolves without a search', async () => {
    const svc = service();
    const out = await createQlooPort(svc).resolveChip({ token: 'a1', name: 'Fleabag' }, undefined, ctx);
    expect(out).toEqual({ status: 'resolved', token: 'a1' });
    expect((svc as unknown as { searchChip: ReturnType<typeof vi.fn> }).searchChip).not.toHaveBeenCalled();
  });

  it('a self-describing custom token resolves without a search', async () => {
    const t = chipToken(ID(5));
    const out = await createQlooPort(service()).resolveChip({ token: t, name: 'x' }, undefined, ctx);
    expect(out).toEqual({ status: 'resolved', token: t });
  });

  it('an unknown token is searched by name; several close hits become options, never an automatic pick', async () => {
    const searchChip = vi.fn(async () => ({
      envelope: ok,
      pick: { kind: 'ambiguous', options: [hit(1, 'Fleabag', '2013 play'), hit(2, 'Fleabag', '2016 series')] },
    }));
    const out = await createQlooPort(service({ searchChip })).resolveChip({ token: 'zz', name: 'Fleabag' }, undefined, ctx);
    expect(out.status).toBe('ambiguous');
    if (out.status !== 'ambiguous') return;
    expect(out.options.map((o) => [o.name, o.hint])).toEqual([['Fleabag', '2013 play'], ['Fleabag', '2016 series']]);
    // Tokens are opaque to the client but decode to the right entity on the server.
    expect(out.options.map((o) => entityIdFromChipToken(o.token))).toEqual([ID(1), ID(2)]);
    expect(searchChip).toHaveBeenCalledTimes(1);
  });

  it('keeps searching other types after no_match and reports no_match at the end', async () => {
    const searchChip = vi.fn(async () => ({ envelope: ok, pick: { kind: 'no_match' } }));
    const out = await createQlooPort(service({ searchChip })).resolveChip({ token: 'zz', name: 'Nothing' }, undefined, ctx);
    expect(out).toEqual({ status: 'no_match' });
    expect(searchChip).toHaveBeenCalledTimes(6);
  });

  it('stops at an auth failure and reports Qloo as unavailable', async () => {
    const searchChip = vi.fn(async () => ({ envelope: { ...ok, code: 'auth' as const }, pick: { kind: 'no_match' } }));
    const out = await createQlooPort(service({ searchChip })).resolveChip({ token: 'zz', name: 'x' }, undefined, ctx);
    expect(out).toEqual({ status: 'unavailable', detail: 'auth' });
    expect(searchChip).toHaveBeenCalledTimes(1);
  });

  it('an answer is accepted only when it is a token the server can resolve', async () => {
    const port = createQlooPort(service());
    const good = chipToken(ID(9));
    expect(await port.resolveChip({ token: 'zz', name: 'x' }, good, ctx)).toEqual({ status: 'resolved', token: good });
    expect(await port.resolveChip({ token: 'zz', name: 'x' }, 'bogus', ctx)).toEqual({ status: 'no_match' });
  });
});

describe('createQlooPort.resolveCandidate', () => {
  it('maps pick kinds and separates no_match from a failed call', async () => {
    const mk = (pick: unknown, code: 'ok' | 'upstream' = 'ok') => createQlooPort(service({ resolveCandidate: vi.fn(async () => ({ envelope: { ...ok, code }, pick })) }));
    const c = { id: 'katz', name: 'Katz', domain: 'place' as const };
    expect(await mk({ kind: 'resolved', entity: hit(1, "Katz's Delicatessen") }).resolveCandidate(c, ctx)).toEqual({ status: 'resolved', matchedName: "Katz's Delicatessen" });
    expect((await mk({ kind: 'ambiguous', options: [] }).resolveCandidate(c, ctx)).status).toBe('ambiguous');
    expect((await mk({ kind: 'no_match' }).resolveCandidate(c, ctx)).status).toBe('no_match');
    expect((await mk({ kind: 'no_match' }, 'upstream').resolveCandidate(c, ctx)).status).toBe('unavailable');
  });
});
