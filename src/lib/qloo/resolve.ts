import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Candidate } from '@/lib/types';
import type { QlooClient } from './client';
import type { QlooEnvelope, RunContext, SearchHit, SearchType } from './types';

/** NFKC, HTML entities already decoded by the client, lower case, apostrophes dropped, other punctuation to spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const NYC_NAMES = new Set(['new york', 'new york city', 'manhattan', 'brooklyn', 'queens', 'bronx', 'the bronx', 'staten island']);

export interface PickOptions {
  /** Keep only hits whose geocode city (normalized) is in this set. */
  cities?: ReadonlySet<string>;
  /** Top hit below this popularity means "no match" (same-name low-popularity fakes). */
  minTopPopularity?: number;
  /** A second hit at or above this popularity makes the pick ambiguous. */
  ambiguousSecond?: number;
}

export type PickResult =
  | { kind: 'resolved'; entity: SearchHit; matchKind: 'exact' | 'prefix' }
  | { kind: 'ambiguous'; options: SearchHit[] }
  | { kind: 'no_match' };

const pop = (h: SearchHit) => h.popularity ?? -1;

/**
 * Chooses one entity from /search hits, for candidates and chips alike.
 * Pool = names equal to the query or starting with it at a word boundary; exact matches win over prefixes.
 */
export function pickEntity(query: string, hits: readonly SearchHit[], opts: PickOptions = {}): PickResult {
  const q = normalizeName(query);
  if (!q) return { kind: 'no_match' };
  const minTop = opts.minTopPopularity ?? 0.5;
  const ambiguousAt = opts.ambiguousSecond ?? 0.9;

  let pool = hits.filter((h) => {
    const n = normalizeName(h.name);
    return n === q || n.startsWith(q + ' ');
  });
  if (opts.cities) pool = pool.filter((h) => !!h.city && opts.cities!.has(normalizeName(h.city)));
  const exact = pool.filter((h) => normalizeName(h.name) === q);
  const matchKind = exact.length > 0 ? 'exact' : 'prefix';
  if (exact.length > 0) pool = exact;
  pool = [...pool].sort((a, b) => pop(b) - pop(a));

  const top = pool[0];
  if (!top || pop(top) < minTop) return { kind: 'no_match' };
  if (pool[1] && pop(pool[1]) >= ambiguousAt) return { kind: 'ambiguous', options: pool.slice(0, 3) };
  return { kind: 'resolved', entity: top, matchKind };
}

export interface ResolveOutcome {
  envelope: QlooEnvelope<SearchHit[]>;
  pick: PickResult;
}

/** Search for a chip the user typed. Same picking rules as candidates; `take` 5. */
export async function searchChip(client: QlooClient, q: string, type: SearchType, ctx: RunContext): Promise<ResolveOutcome> {
  const envelope = await client.search({ query: q, type, take: 5 }, ctx);
  const pick = envelope.data ? pickEntity(q, envelope.data) : ({ kind: 'no_match' } as const);
  return { envelope, pick };
}

/** Resolves one catalog candidate. Places search wider (take 10) and keep only the five New York boroughs. */
export async function resolveCandidate(
  client: QlooClient,
  candidate: Pick<Candidate, 'name' | 'domain'>,
  ctx: RunContext,
): Promise<ResolveOutcome> {
  const isPlace = candidate.domain === 'place';
  const envelope = await client.search({ query: candidate.name, type: candidate.domain, take: isPlace ? 10 : 5 }, ctx);
  const pick = envelope.data ? pickEntity(candidate.name, envelope.data, isPlace ? { cities: NYC_NAMES } : {}) : ({ kind: 'no_match' } as const);
  return { envelope, pick };
}

/**
 * Opaque chip token for a custom (searched) chip. The Qloo entity id is encrypted (AES-256-GCM) with
 * `PERKFIT_SECRET`, so the server needs no session state and the browser never sees a Qloo id in clear text.
 * Without `PERKFIT_SECRET` a process-local random key is used (fine for tests and single-process dev;
 * tokens then do not survive a cold start, which only affects custom chips in local runs).
 */
export function chipToken(entityId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const body = Buffer.concat([cipher.update(entityId.toUpperCase(), 'utf8'), cipher.final()]);
  return 'c_' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** Inverse of `chipToken`; undefined for anything else (example tokens go through the precache chip map). */
export function entityIdFromChipToken(token: string): string | undefined {
  if (!token.startsWith('c_')) return undefined;
  try {
    const raw = Buffer.from(token.slice(2), 'base64url');
    if (raw.length < 12 + 16 + 1) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const id = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

let processKey: Buffer | undefined;
function tokenKey(): Buffer {
  const secret = process.env.PERKFIT_SECRET;
  if (secret && secret.length >= 32) return createHash('sha256').update(secret).digest();
  processKey ??= randomBytes(32);
  return processKey;
}
