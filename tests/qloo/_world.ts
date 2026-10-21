import { createQlooClient } from '@/lib/qloo/client';
import { createPacer } from '@/lib/qloo/pacer';
import { Precache, SCHEMA_VERSION, type PrecacheData } from '@/lib/qloo/precache';
import { createQlooService, type QlooService } from '@/lib/qloo';
import type { Candidate, Segment } from '@/lib/types';
import { entity, type FakeQloo } from '../helpers/fake-qloo';

const c = (id: string, name: string, domain: Candidate['domain']): Candidate => ({ id, name, domain, unitCost: 5, billing: 'per_use', friction: 1 });

/** Candidates named after the synthetic fixture entities. */
export const TEST_CANDIDATES: Candidate[] = [
  c('harbor_deli', 'Harbor Deli', 'place'),
  c('corner_pizza', 'Corner Pizza House', 'place'),
  c('demo_burger', 'Demo Burger Stand', 'place'),
  c('sample_bakery', 'Sample Bakery', 'place'),
  c('test_smokehouse', 'Test Smokehouse', 'place'),
  c('series_one', 'Demo Series One', 'tv_show'),
  c('series_two', 'Demo Series Two', 'tv_show'),
  c('series_three', 'Demo Series Three', 'tv_show'),
  c('series_four', 'Demo Series Four', 'tv_show'),
  c('series_six', 'Demo Series Six', 'tv_show'),
  c('sample_apparel', 'Sample Apparel', 'brand'),
  c('demo_outfitters', 'Demo Outfitters', 'brand'),
  c('mock_sneakers', 'Mock Sneakers', 'brand'),
  c('test_cosmetics', 'Test Cosmetics', 'brand'),
  c('placeholder_optics', 'Placeholder Optics', 'brand'),
  c('placeholder_atlas', 'Placeholder Atlas', 'book'),
  c('demo_chronicles', 'Demo Chronicles', 'book'),
  c('mock_almanac', 'Mock Almanac', 'book'),
  c('sample_memoir', 'Sample Memoir & Notes', 'book'),
  c('test_handbook', 'Test Handbook', 'book'),
];

const idOf = (name: string, type: string, nth = 0) => entity(name, type, nth).id;

/** Candidate id -> entity id as the resolve script would have produced it (null = no match). */
export const CANDIDATE_MAP: Record<string, string | null> = {
  harbor_deli: idOf('Harbor Deli', 'place', 0),
  corner_pizza: idOf('Corner Pizza House', 'place', 0),
  demo_burger: idOf('Demo Burger Stand', 'place'),
  sample_bakery: idOf('Sample Bakery', 'place'),
  test_smokehouse: idOf('Test Smokehouse', 'place'),
  series_one: idOf('Demo Series One', 'tv_show'),
  series_two: idOf('Demo Series Two', 'tv_show'),
  series_three: idOf('Demo Series Three', 'tv_show', 0),
  series_four: idOf('Demo Series Four', 'tv_show'),
  series_six: null,
  sample_apparel: idOf('Sample Apparel', 'brand'),
  demo_outfitters: idOf('Demo Outfitters', 'brand'),
  mock_sneakers: idOf('Mock Sneakers', 'brand'),
  test_cosmetics: idOf('Test Cosmetics', 'brand'),
  placeholder_optics: idOf('Placeholder Optics', 'brand'),
  placeholder_atlas: idOf('Placeholder Atlas: A Subtitled Edition', 'book'),
  demo_chronicles: idOf('Demo Chronicles', 'book'),
  mock_almanac: idOf('Mock Almanac', 'book'),
  sample_memoir: idOf('Sample Memoir &amp; Notes', 'book'),
  test_handbook: idOf('Test Handbook', 'book'),
};

export const CHIP_MAP: Record<string, string> = {
  a1: idOf('Synthetic Singer', 'artist', 0),
  a2: idOf('Synthetic Drama', 'tv_show'),
  a3: idOf('Imaginary Boutique', 'brand'),
  a4: idOf('Fake Folk Duo', 'artist'),
  b1: idOf('Demo Band', 'artist', 0),
  b2: idOf('Fake Folk Duo', 'artist'),
  b3: idOf('Fictional Jewelers', 'brand'),
};

const chips = (...tokens: string[]) => tokens.map((token) => ({ token, name: `chip ${token}` }));

export const SEG_A: Segment = { id: 'example_a', label: 'A', age: '25_to_29', interests: chips('a1', 'a2', 'a3') };
export const SEG_A_REORDERED: Segment = { ...SEG_A, interests: chips('a3', 'a1', 'a2') };
export const SEG_A2: Segment = { id: 'custom', label: 'A2', age: '25_to_29', interests: chips('a1', 'a2', 'a4') };
export const SEG_B: Segment = { id: 'example_b', label: 'B', age: '55_and_older', interests: chips('b1', 'b2', 'b3') };

export function precacheData(overrides: Partial<PrecacheData> = {}): PrecacheData {
  return { schemaVersion: SCHEMA_VERSION, fetchedAt: '2026-01-01T00:00:00.000Z', chipMap: CHIP_MAP, candidateMap: CANDIDATE_MAP, entries: [], extras: {}, ...overrides };
}

export interface TestService {
  svc: QlooService;
  fake: FakeQloo;
}

/** Service over the fake transport with no pacing delay and short retry/timeout waits. */
export function makeService(
  fake: FakeQloo,
  opts: { precache?: Precache | null; callTimeoutMs?: number; retryDelayMs?: number } = {},
): QlooService {
  const client = createQlooClient({
    transport: fake.transport,
    pacer: createPacer({ intervalMs: 0, concurrency: 2 }),
    callTimeoutMs: opts.callTimeoutMs ?? 2_000,
    retryDelayMs: opts.retryDelayMs ?? 5,
  });
  return createQlooService({ client, precache: opts.precache === undefined ? new Precache(precacheData()) : opts.precache });
}
