import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createQlooClient, createRunContext } from '@/lib/qloo/client';
import { createPacer } from '@/lib/qloo/pacer';
import { fetchTransport } from '@/lib/qloo/transport';
import { loadQlooConfig } from '@/lib/qloo/config';
import { FAKE_KEY, entity, startFakeHttpServer } from '../helpers/fake-qloo';

vi.mock('server-only', () => ({}));

let server: Awaited<ReturnType<typeof startFakeHttpServer>>;
beforeAll(async () => {
  server = await startFakeHttpServer();
});
afterAll(async () => {
  await server.close();
});

const query = () => ({
  type: 'place' as const,
  interestEntityIds: [entity('Synthetic Singer', 'artist').id],
  age: '25_to_29' as const,
  candidateEntityIds: [entity('Harbor Deli', 'place').id, entity('Sample Bakery', 'place').id],
});

describe('real fetch path', () => {
  it('sends X-Api-Key, parses the response, and leaks the key nowhere', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const client = createQlooClient({
      transport: fetchTransport({ apiKey: FAKE_KEY, baseUrl: server.baseUrl }),
      pacer: createPacer({ intervalMs: 0, concurrency: 2 }),
    });
    const env = await client.insights(query(), createRunContext());
    expect(env.code).toBe('ok');
    expect(env.data).toHaveLength(2);
    expect(server.seenKeys.at(-1)).toBe(FAKE_KEY);

    const search = await client.search({ query: 'Sample Memoir & Notes', type: 'book', take: 5 }, createRunContext());
    expect(search.data?.[0].name).toBe('Sample Memoir & Notes');

    const logged = spies.flatMap((s) => s.mock.calls.flat()).join(' ');
    expect(logged).not.toContain(FAKE_KEY);
    expect(JSON.stringify(env)).not.toContain(FAKE_KEY);
    spies.forEach((s) => s.mockRestore());
  });

  it('a wrong key is an auth envelope without the key in detail', async () => {
    const client = createQlooClient({
      transport: fetchTransport({ apiKey: 'wrong-synthetic-key', baseUrl: server.baseUrl }),
      pacer: createPacer({ intervalMs: 0, concurrency: 2 }),
    });
    const env = await client.insights(query(), createRunContext());
    expect(env.code).toBe('auth');
    expect(env.httpStatus).toBe(401);
    expect(JSON.stringify(env)).not.toContain('wrong-synthetic-key');
  });

  it('no configured key means 401 without any request', async () => {
    const before = server.seenKeys.length;
    const client = createQlooClient({
      transport: fetchTransport({ baseUrl: server.baseUrl }),
      pacer: createPacer({ intervalMs: 0, concurrency: 2 }),
    });
    expect((await client.insights(query(), createRunContext())).code).toBe('auth');
    expect(server.seenKeys.length).toBe(before);
  });

  it('config trims the base URL and reads the key only from the environment object', () => {
    const c = loadQlooConfig({ QLOO_API_KEY: ' k ', QLOO_BASE_URL: 'https://example.invalid///' });
    expect(c).toEqual({ apiKey: 'k', baseUrl: 'https://example.invalid' });
    expect(loadQlooConfig({}).baseUrl).toBe('https://hackathon.api.qloo.com');
  });
});
