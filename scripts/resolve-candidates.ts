import { PRIVATE_DIR, readPrivateJson, requireKey, writePrivate } from './_boot';
import { CANDIDATES } from '@/data/candidates';
import { createQlooService } from '@/lib/qloo';

/**
 * Resolves the 20 catalog candidates to Qloo entity ids with the same rules the app uses.
 * Output (git-ignored): .private/candidate-map.json  { candidateMap, report }
 * Ambiguous or wrong picks are fixed by hand in .private/candidate-overrides.json { "<candidateId>": "<entityId>" }.
 * The console shows names and kinds only, never ids.
 */
async function main(): Promise<void> {
  requireKey();
  const svc = createQlooService({ precache: null });
  const ctx = svc.createRunContext({ deadlineMs: 5 * 60_000 });
  const overrides = readPrivateJson<Record<string, string>>('candidate-overrides.json') ?? {};

  const candidateMap: Record<string, string | null> = {};
  const report: { candidateId: string; kind: string; matchKind?: string; options?: { name: string; disambiguation?: string; popularity: number | null; entityId: string }[] }[] = [];
  let unresolved = 0;

  for (const c of CANDIDATES) {
    if (overrides[c.id]) {
      candidateMap[c.id] = overrides[c.id].toUpperCase();
      report.push({ candidateId: c.id, kind: 'override' });
      console.log(`${c.id.padEnd(18)} override`);
      continue;
    }
    const { envelope, pick } = await svc.resolveCandidate(c, ctx);
    if (envelope.code !== 'ok' && envelope.code !== 'empty') {
      console.error(`${c.id}: search failed (${envelope.code}: ${envelope.detail})`);
      process.exit(1);
    }
    if (pick.kind === 'resolved') {
      candidateMap[c.id] = pick.entity.entityId;
      report.push({ candidateId: c.id, kind: 'resolved', matchKind: pick.matchKind });
      console.log(`${c.id.padEnd(18)} resolved (${pick.matchKind}) -> ${pick.entity.name}`);
    } else if (pick.kind === 'ambiguous') {
      candidateMap[c.id] = null;
      unresolved++;
      report.push({
        candidateId: c.id,
        kind: 'ambiguous',
        options: pick.options.map((o) => ({ name: o.name, disambiguation: o.disambiguation, popularity: o.popularity, entityId: o.entityId })),
      });
      console.log(`${c.id.padEnd(18)} AMBIGUOUS`);
      pick.options.forEach((o, i) => console.log(`    ${i + 1}. ${o.name} | ${o.disambiguation ?? '-'} | popularity ${o.popularity ?? 'null'}`));
    } else {
      candidateMap[c.id] = null;
      report.push({ candidateId: c.id, kind: 'no_match' });
      console.log(`${c.id.padEnd(18)} no_match`);
    }
  }

  const file = writePrivate('candidate-map.json', JSON.stringify({ candidateMap, report }, null, 2));
  const count = (k: string) => report.filter((r) => r.kind === k).length;
  console.log(
    `\n${CANDIDATES.length} candidates: resolved ${count('resolved')} (exact ${report.filter((r) => r.matchKind === 'exact').length}, prefix ${report.filter((r) => r.matchKind === 'prefix').length}), override ${count('override')}, ambiguous ${count('ambiguous')}, no_match ${count('no_match')}; network calls ${ctx.stats.networkCalls}`,
  );
  console.log(`written: ${file.replace(PRIVATE_DIR, '.private')}`);
  if (unresolved > 0) {
    console.log('Ambiguous entries have options (with ids) in the map file report. Pick one and add it to .private/candidate-overrides.json.');
    process.exitCode = 2;
  }
}

main().catch((e: unknown) => {
  console.error('resolve-candidates failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
