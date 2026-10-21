import { DOMAINS } from '@/lib/types';
import {
  askUserOp,
  explainOp,
  holdoutPlanOp,
  llmAloneOp,
  optimizeBundleOp,
  resolveChipOp,
  scoreDomainOp,
} from './ops';
import { RunFailure, type RunSession } from './session';

export type CompleteOutcome = 'done' | 'asked';

/**
 * Deterministic orchestrator: runs the same operations as the tools, in fixed order, skipping what the
 * loop already did. Makes no decisions (no perk re-resolution, no facts choice), so it is also the
 * whole pipeline for sample mode, cache replay and runs without an LLM.
 */
export async function completeDeterministically(s: RunSession): Promise<CompleteOutcome> {
  s.inFallback = true;

  // 1. Chips. An ambiguous chip ends the run with a question; an unusable one is a request error.
  for (const chip of s.req.segment.interests) {
    if (s.chips.get(chip.token)?.status === 'resolved') continue;
    if (!s.chips.has(chip.token)) await resolveChipOp(s, chip.token);
  }
  if (!s.chipsResolved()) {
    const ambiguous = s.req.segment.interests.find((c) => s.chips.get(c.token)?.status === 'ambiguous');
    if (ambiguous) {
      if (!s.asked) askUserOp(s, ambiguous.token);
      return 'asked';
    }
    const bad = s.req.segment.interests.find((c) => s.chips.get(c.token)?.status !== 'resolved');
    const why = bad ? s.chips.get(bad.token)?.status : 'unknown';
    throw new RunFailure(
      why === 'unavailable' ? 'qloo_unavailable' : 'invalid_request',
      `Interest chip could not be resolved (${why})`,
      'segment.interests',
    );
  }

  // 2. Scoring (four domains) alongside the comparison pick.
  await Promise.all([
    ...DOMAINS.filter((d) => !s.domainResults.has(d)).map((d) => scoreDomainOp(s, d)),
    s.llmAlone ? Promise.resolve() : llmAloneOp(s),
  ]);

  // 3. Bundle, explanations, holdout.
  if (!s.run) optimizeBundleOp(s);
  if (!s.explain) await explainOp(s);
  if (!s.holdoutDone) holdoutPlanOp(s);
  return 'done';
}
