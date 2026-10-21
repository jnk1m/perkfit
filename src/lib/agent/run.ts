import { hashInputs } from '@/lib/engine';
import type { RunEvent, RunRequest } from '@/lib/api/types';
import { CANDIDATES } from '@/data/candidates';
import type { RunMeta } from '@/lib/types';
import { readRunExtras } from './extras';
import { completeDeterministically } from './fallback';
import { runAgentLoop } from './loop';
import type { AgentDeps } from './ports';
import { RunFailure, RunSession } from './session';

function failureEvent(err: unknown): RunEvent {
  if (err instanceof RunFailure) {
    return { type: 'error', error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } };
  }
  const name = err instanceof Error ? err.name : 'Error';
  return { type: 'error', error: { code: 'internal', message: `Run failed (${name})` } };
}

/**
 * Runs one PerkFit request and reports through `emit` (NDJSON events). Never throws.
 *
 * Source selection: sample mode (request or env) never calls Qloo or the LLM for text.
 * A precache hit with stored extras replays the stored trace and sentences with no LLM calls.
 * Otherwise the model-driven loop runs when a loop model is available, and the deterministic
 * orchestrator finishes whatever the loop left undone.
 */
export async function runPerkFit(req: RunRequest, emit: (e: RunEvent) => void, deps: AgentDeps): Promise<void> {
  const catalog = deps.candidates ?? CANDIDATES;
  let s: RunSession | undefined;
  try {
    for (const id of Object.keys(req.candidateOverrides)) {
      if (!catalog.some((c) => c.id === id)) {
        throw new RunFailure('invalid_request', `Unknown candidate in overrides: ${id}`, `candidateOverrides.${id}`);
      }
    }
    const sample = deps.sampleMode ?? (req.mode === 'sample' || process.env.PERKFIT_MODE === 'sample');
    s = new RunSession(req, deps, catalog, emit, sample);

    const inputHash = hashInputs(s.requestInput, s.engineConfig);
    if (!sample && !deps.skipReplay) s.replay = readRunExtras(deps.precache, inputHash);

    if (!s.replay && !sample && s.useLlm && deps.loopModel) {
      await runAgentLoop(s);
    }
    const outcome = await completeDeterministically(s);
    if (outcome === 'asked') {
      emit({ type: 'trace', steps: s.trace });
      return;
    }

    const trace = s.replay ? s.replay.trace : s.trace;
    emit({ type: 'trace', steps: trace });

    const explain = s.explain;
    const total = explain?.items.length ?? 0;
    const discarded = explain?.stats.discarded ?? 0;
    const passed = explain?.templates.length ?? 0;
    const llm: RunMeta['llm'] = s.replay ? 'cached' : s.useLlm ? (explain?.llm === 'ok' ? 'ok' : 'failed') : 'skipped';
    const meta = s.meta(llm, { total, passed, discarded });

    deps.onArtifacts?.({
      inputHash,
      templates: explain?.templates ?? [],
      llmAlone:
        s.llmAlone?.status === 'ok'
          ? { status: 'ok', picks: s.llmAlone.result.bundleIds, dropped: s.llmAlone.result.droppedOverBudget }
          : s.llmAlone?.status === 'failed'
            ? { status: 'failed', picks: [], dropped: [] }
            : null,
      trace,
    });
    emit({ type: 'done', meta });
  } catch (err) {
    try {
      emit(failureEvent(err));
    } catch {
      // The consumer is gone; nothing left to tell.
    }
  }
}
