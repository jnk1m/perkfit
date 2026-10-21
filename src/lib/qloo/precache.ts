import 'server-only';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { normalizeId } from './guard';
import type { StoredDomainScore } from './types';

/** Bump when the stored shape or the key recipe changes; old precache blobs are then ignored. */
export const SCHEMA_VERSION = 'perkfit-qloo-1';

/** Everything about a segment that changes Qloo's answer. Chip order does not (sorted in the key). */
export interface SegmentSignal {
  age: string;
  gender?: string;
  interestEntityIds: readonly string[];
}

/** Run-unit cache key: `sha256(schemaVersion + normalized segment signal + sorted candidate ids)`. */
export function precacheKey(signal: SegmentSignal, candidateEntityIds: readonly string[]): string {
  const sort = (ids: readonly string[]) => [...new Set(ids.map(normalizeId))].sort().join(',');
  const raw = [SCHEMA_VERSION, `age=${signal.age}`, `gender=${signal.gender ?? ''}`, `i=${sort(signal.interestEntityIds)}`, `c=${sort(candidateEntityIds)}`].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

const storedScore = z.object({
  entityId: z.string(),
  status: z.enum(['ok', 'no_data']),
  reason: z.enum(['not_returned', 'no_affinity']).optional(),
  affinity: z.number().nullable(),
  popularity: z.number().nullable(),
  explain: z.array(z.object({ entityId: z.string(), score: z.number() })),
});

const precacheSchema = z.object({
  schemaVersion: z.string(),
  fetchedAt: z.string(),
  /** Chip token -> Qloo entity id (examples only; custom chips carry their id in the token). */
  chipMap: z.record(z.string(), z.string()),
  /** Candidate id -> Qloo entity id, or null when no confident match exists. */
  candidateMap: z.record(z.string(), z.string().nullable()),
  entries: z.array(
    z.object({
      key: z.string(),
      code: z.enum(['ok', 'empty', 'no_signal']).default('ok'),
      scores: z.array(storedScore),
      ledgerParams: z.record(z.string(), z.string()).optional(),
    }),
  ),
  /** Reserved for later additions such as pre-verified explanation sentences. */
  extras: z.record(z.string(), z.unknown()).default({}),
});

export type PrecacheData = z.infer<typeof precacheSchema>;

/** Read-only view over a decoded precache. */
export class Precache {
  private readonly byKey = new Map<string, StoredDomainScore>();

  constructor(readonly data: PrecacheData) {
    for (const e of data.entries) this.byKey.set(e.key, { code: e.code, scores: e.scores });
  }

  get fetchedAt(): string {
    return this.data.fetchedAt;
  }

  get size(): number {
    return this.byKey.size;
  }

  lookup(key: string): StoredDomainScore | undefined {
    return this.byKey.get(key);
  }

  /** Entity id for an example chip token, if this precache knows it. */
  chipEntityId(token: string): string | undefined {
    const id = this.data.chipMap[token];
    return id ? normalizeId(id) : undefined;
  }

  /** `undefined` = unknown candidate, `null` = known to have no Qloo match. */
  candidateEntityId(candidateId: string): string | null | undefined {
    if (!(candidateId in this.data.candidateMap)) return undefined;
    const id = this.data.candidateMap[candidateId];
    return id ? normalizeId(id) : null;
  }
}

export type DecodeResult = { ok: true; precache: Precache } | { ok: false; reason: string };

/** base64 -> gunzip -> JSON -> zod. Reasons carry the failing step, never content. */
export function decodePrecache(b64: string): DecodeResult {
  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
  } catch {
    return { ok: false, reason: 'precache is not base64 gzip JSON' };
  }
  const parsed = precacheSchema.safeParse(json);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((i) => i.path.map((p) => (typeof p === 'number' ? '[]' : String(p))).join('.')))];
    return { ok: false, reason: `precache schema mismatch at ${paths.slice(0, 3).join(',')}` };
  }
  if (parsed.data.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `precache schemaVersion ${parsed.data.schemaVersion} != ${SCHEMA_VERSION}` };
  }
  return { ok: true, precache: new Precache(parsed.data) };
}

/** Inverse of `decodePrecache`, used by the build script. */
export function encodePrecache(data: PrecacheData): string {
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 }).toString('base64');
}

/** Loads `PERKFIT_PRECACHE`. Missing is normal (null, no error); a broken blob is reported, not hidden. */
export function loadPrecacheFromEnv(env: Record<string, string | undefined> = process.env): { precache: Precache | null; error?: string } {
  const raw = env.PERKFIT_PRECACHE?.trim();
  if (!raw) return { precache: null };
  const res = decodePrecache(raw);
  return res.ok ? { precache: res.precache } : { precache: null, error: res.reason };
}
