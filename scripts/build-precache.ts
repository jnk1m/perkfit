import { PRIVATE_DIR, readPrivateJson, requireKey, writePrivate } from './_boot';
import { CANDIDATES, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { createQlooService } from '@/lib/qloo';
import { Precache, SCHEMA_VERSION, encodePrecache, type PrecacheData } from '@/lib/qloo/precache';
import { DOMAINS, type Segment } from '@/lib/types';
import type { SearchType } from '@/lib/qloo';

/**
 * Builds the PERKFIT_PRECACHE blob with the real API:
 *   2 example segments x 7 chip subsets x 4 domains = 56 insights calls, plus the chip and candidate maps.
 * Needs .private/candidate-map.json from `tsx scripts/resolve-candidates.ts`.
 * Output: .private/precache.b64 (git-ignored). The `extras` object is left empty for later additions
 * (verified explanation sentences, agent trace).
 */
const CHIP_TYPES: Record<string, SearchType> = { a1: 'tv_show', a2: 'artist', a3: 'brand', b1: 'tv_show', b2: 'artist', b3: 'brand' };

/** All non-empty subsets of the chips, original order kept. 3 chips -> 7 subsets. */
function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

async function main(): Promise<void> {
  requireKey();
  const map = readPrivateJson<{ candidateMap: Record<string, string | null>; report: { candidateId: string; kind: string }[] }>('candidate-map.json');
  if (!map) throw new Error('.private/candidate-map.json is missing. Run scripts/resolve-candidates.ts first.');
  const open = map.report.filter((r) => r.kind === 'ambiguous');
  if (open.length > 0) throw new Error(`unresolved ambiguous candidates: ${open.map((r) => r.candidateId).join(', ')}. Add overrides and re-run resolve.`);

  // Chips: resolve the six example chips by name. An ambiguous chip takes the most popular option and is reported.
  const bootstrap = createQlooService({ precache: null });
  const ctx0 = bootstrap.createRunContext({ deadlineMs: 5 * 60_000 });
  const chipMap: Record<string, string> = {};
  for (const seg of EXAMPLE_SEGMENTS) {
    for (const chip of seg.interests) {
      const { envelope, pick } = await bootstrap.searchChip(chip.name, CHIP_TYPES[chip.token], ctx0);
      if (pick.kind === 'no_match') throw new Error(`chip ${chip.token} has no match (search ${envelope.code})`);
      const entity = pick.kind === 'resolved' ? pick.entity : pick.options[0];
      chipMap[chip.token] = entity.entityId;
      console.log(`chip ${chip.token}: ${pick.kind}${pick.kind === 'ambiguous' ? ' (took most popular; check the name)' : ''}`);
    }
  }

  const shell = new Precache({
    schemaVersion: SCHEMA_VERSION,
    fetchedAt: new Date().toISOString(),
    chipMap,
    candidateMap: map.candidateMap,
    entries: [],
    extras: {},
  });
  const svc = createQlooService({ precache: shell });
  const ctx = svc.createRunContext({ deadlineMs: 15 * 60_000 });

  const entries: PrecacheData['entries'] = [];
  for (const seg of EXAMPLE_SEGMENTS) {
    for (const subset of subsets(seg.interests)) {
      const variant: Segment = { ...seg, interests: subset };
      for (const domain of DOMAINS) {
        const r = await svc.scoreDomain(domain, variant, [...CANDIDATES], ctx);
        if (r.envelope.code !== 'ok' || !r.stored || !r.cacheKey) {
          throw new Error(`${seg.id} chips=${subset.map((c) => c.token).join('+')} ${domain}: ${r.envelope.code} ${r.envelope.detail ?? ''}`);
        }
        entries.push({ key: r.cacheKey, code: r.stored.code, scores: r.stored.scores, ledgerParams: r.callSummary.params });
      }
    }
    console.log(`${seg.id}: ${entries.length} entries so far`);
  }

  const data: PrecacheData = { ...shell.data, fetchedAt: new Date().toISOString(), entries, extras: {} };
  const b64 = encodePrecache(data);
  const file = writePrivate('precache.b64', b64);
  console.log(
    `entries ${entries.length} (expected 56) | network calls ${ctx.stats.networkCalls}, retries ${ctx.stats.retries}, no_data ${ctx.stats.noData}, no_match ${ctx.stats.noMatch}`,
  );
  console.log(`json ${JSON.stringify(data).length} bytes -> base64 gzip ${b64.length} bytes`);
  console.log(`written: ${file.replace(PRIVATE_DIR, '.private')}`);
  if (entries.length !== 56) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('build-precache failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
