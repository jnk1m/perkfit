import { PRIVATE_DIR, writePrivate } from './_boot';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { createQlooPort } from '@/lib/agent/qloo-port';
import { withRunExtras } from '@/lib/agent/extras';
import type { RunArtifacts } from '@/lib/agent/ports';
import { runPerkFit } from '@/lib/agent/run';
import type { RunEvent, RunRequest } from '@/lib/api/types';
import { createAiSdkClient } from '@/lib/llm/client';
import { getModel, getModelId } from '@/lib/llm/model';
import { createQlooService } from '@/lib/qloo';
import { decodePrecache, encodePrecache } from '@/lib/qloo/precache';

/**
 * Adds, for each example segment at its default inputs, the verified slot templates, the LLM-alone pick
 * and the agent trace to the precache `extras`. Runs the real tool loop with the real model.
 *
 *   tsx scripts/build-precache-explanations.ts [--in .private/precache.b64] [--out .private/precache.full.b64]
 *
 * Needs ANTHROPIC_API_KEY (and QLOO_API_KEY only if the precache lacks an entry). The output holds LLM
 * text templates and candidate ids, not Qloo responses. Read the printed summary before using the file.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Put it in .env.local.');
    process.exit(1);
  }
  const inFile = path.resolve(arg('--in', path.join(PRIVATE_DIR, 'precache.b64')));
  if (!existsSync(inFile)) {
    console.error(`precache input not found: ${inFile}. Run scripts/build-precache.ts first.`);
    process.exit(1);
  }
  const decoded = decodePrecache(readFileSync(inFile, 'utf8').trim());
  if (!decoded.ok) {
    console.error(`precache input is not usable: ${decoded.reason}`);
    process.exit(1);
  }
  const data = decoded.precache.data;

  const service = createQlooService({ precache: decoded.precache });
  const modelId = getModelId();
  const model = getModel();
  const llm = createAiSdkClient(model, modelId);

  let extras = data.extras;
  let failures = 0;
  for (const segment of EXAMPLE_SEGMENTS) {
    const req: RunRequest = {
      mode: 'live',
      segment,
      candidateOverrides: {},
      budget: DEFAULT_BUDGET,
      members: DEFAULT_MEMBERS,
      includeLlm: true,
    };
    const events: RunEvent[] = [];
    let artifacts: RunArtifacts | undefined;
    await runPerkFit(req, (e) => events.push(e), {
      qloo: createQlooPort(service),
      precache: decoded.precache,
      llm,
      loopModel: model,
      sampleMode: false,
      skipReplay: true,
      onArtifacts: (a) => (artifacts = a),
    });

    const done = events.find((e) => e.type === 'done');
    const error = events.find((e) => e.type === 'error');
    const trace = events.find((e) => e.type === 'trace');
    if (!done || done.type !== 'done' || !artifacts) {
      failures += 1;
      console.error(`${segment.id}: run did not finish${error && error.type === 'error' ? ` (${error.error.code}: ${error.error.message})` : ''}`);
      continue;
    }
    const m = done.meta;
    const fellBack = trace?.type === 'trace' && trace.steps.some((s) => s.summary.startsWith('[fallback]'));
    console.log(
      `${segment.id}: llm=${m.llm} explanations ${m.explanations.passed}/${m.explanations.total} verified, ${m.explanations.discarded} discarded | agent steps ${m.agentSteps} | qloo network calls ${m.qlooCalls - m.cacheHits} cache hits ${m.cacheHits}${fellBack ? ' | FALLBACK USED' : ''}`,
    );
    if (m.llm !== 'ok' || artifacts.templates.length === 0) {
      failures += 1;
      console.error(`${segment.id}: not stored (llm=${m.llm}, ${artifacts.templates.length} verified templates)`);
      continue;
    }
    extras = withRunExtras(extras, artifacts.inputHash, artifacts);
  }

  const outFile = writePrivate(path.basename(arg('--out', 'precache.full.b64')), encodePrecache({ ...data, extras }));
  console.log(`written: ${outFile.replace(PRIVATE_DIR, '.private')} (model ${modelId})`);
  if (failures > 0) {
    console.error(`${failures} segment(s) not stored. Fix and re-run before using this file.`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error('build-precache-explanations failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
