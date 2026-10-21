import { requireKey } from './_boot';
import { CANDIDATES, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { chipToken, createQlooService } from '@/lib/qloo';
import type { SearchType } from '@/lib/qloo';
import type { Segment } from '@/lib/types';

/**
 * Live smoke test: one domain (brand) for example A against the real API.
 * Prints counts and statuses only. Nothing is written to disk.
 */
const CHIP_TYPES: Record<string, SearchType> = { a1: 'tv_show', a2: 'artist', a3: 'brand' };

async function main(): Promise<void> {
  requireKey();
  const svc = createQlooService({ precache: null });
  const ctx = svc.createRunContext({ deadlineMs: 2 * 60_000 });
  const example = EXAMPLE_SEGMENTS[0];

  const interests: Segment['interests'] = [];
  for (const chip of example.interests) {
    const { pick } = await svc.searchChip(chip.name, CHIP_TYPES[chip.token], ctx);
    if (pick.kind === 'no_match') throw new Error(`chip "${chip.token}" did not resolve`);
    const entity = pick.kind === 'resolved' ? pick.entity : pick.options[0];
    interests.push({ token: chipToken(entity.entityId), name: chip.name });
    console.log(`chip ${chip.token}: ${pick.kind}`);
  }
  const segment: Segment = { ...example, interests };

  const brands = CANDIDATES.filter((c) => c.domain === 'brand');
  for (const c of brands) {
    const { pick } = await svc.resolveCandidate(c, ctx);
    console.log(`candidate ${c.id}: ${pick.kind}`);
  }

  const r = await svc.scoreDomain('brand', segment, [...CANDIDATES], ctx);
  const n = (s: string) => r.scores.filter((x) => x.status === s).length;
  console.log(
    `brand insights: code=${r.envelope.code} http=${r.envelope.httpStatus ?? '-'} source=${r.envelope.source} ${r.envelope.latencyMs}ms | scores ok=${n('ok')} no_data=${n('no_data')} no_match=${n('no_match')} | explain on ok=${r.scores.filter((x) => x.explain.length > 0).length}`,
  );
  console.log(`network calls ${ctx.stats.networkCalls}, retries ${ctx.stats.retries}`);

  const pass = r.envelope.code === 'ok' && n('ok') >= 3;
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('smoke-live failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
