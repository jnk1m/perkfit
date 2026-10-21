import { generateText, isStepCount } from 'ai';
import { DOMAINS } from '@/lib/types';
import { createTools } from './tools';
import type { RunSession } from './session';

export const LOOP_SYSTEM = `You operate PerkFit, a tool that picks partner perks for a customer segment by taste fit, inside a budget.
You only call tools. You never write numbers, names or explanations yourself; every figure comes from tool code.

Plan:
1. Call resolve_chip once for each interest chip of the segment (all in one step).
   If a chip is ambiguous, call ask_user for it and stop.
2. In one step, call score_domain for place, tv_show, brand and book, and call llm_alone.
3. Look at the no_data lists. For a perk that failed to match, you may call resolve_candidate once or twice with a better
   search name (for example the common spelling). Retry only when you have a concrete alternative name. Skip this step if nothing is worth retrying.
4. Call optimize_bundle.
5. In one step, call explain and holdout_plan.
Then stop. Do not repeat a tool that already succeeded. If a tool reports ok=false with an error, follow its instruction or move on.
You have a small step and call budget; do not call read_popularity unless something looks wrong.`;

export interface LoopOutcome {
  endedBy: 'complete' | 'asked' | 'step_limit' | 'llm_budget' | 'deadline' | 'error';
  error?: string;
}

/** True when the model has nothing left to do or must not continue. */
function shouldStop(s: RunSession): boolean {
  if (s.asked) return true;
  if (s.run && s.explain && s.holdoutDone) return true;
  if (s.remainingMs() < 1_000) return true;
  return false;
}

/**
 * Model-driven tool loop. The model chooses order and the three real branches
 * (re-resolve a perk, ask the user about a chip, which facts explain cites).
 * Always returns normally; the caller completes anything left undone deterministically.
 */
export async function runAgentLoop(s: RunSession): Promise<LoopOutcome> {
  const model = s.deps.loopModel;
  if (!model) return { endedBy: 'error', error: 'no loop model configured' };
  s.loopAttempted = true;
  const tools = createTools(s);

  const prompt = JSON.stringify({
    task: 'Score and bundle perks for this segment.',
    segment: { id: s.segment.id, age: s.segment.age, chipTokens: s.req.segment.interests.map((c) => c.token) },
    domains: DOMAINS,
    budget: s.req.budget,
    members: s.req.members,
    includeLlm: s.req.includeLlm,
  });

  let endedBy: LoopOutcome['endedBy'] = 'complete';
  try {
    const result = await generateText({
      model,
      system: LOOP_SYSTEM,
      prompt,
      tools,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(Math.max(1_000, s.remainingMs())),
      stopWhen: [
        isStepCount(s.limits.steps),
        ({ steps }) => {
          s.loopCalls = steps.length;
          if (shouldStop(s)) return true;
          // Keep room for the inner explain and llm_alone calls.
          return s.loopCalls + s.innerCalls + s.pendingInnerCalls() >= s.limits.llmCalls;
        },
      ],
      prepareStep: ({ stepNumber }) => {
        s.loopCalls = stepNumber + 1;
        return undefined;
      },
    });
    s.loopCalls = result.steps.length;
    if (s.asked) endedBy = 'asked';
    else if (!(s.run && s.explain && s.holdoutDone)) {
      endedBy = result.steps.length >= s.limits.steps ? 'step_limit' : s.llmCalls >= s.limits.llmCalls ? 'llm_budget' : 'complete';
    }
    return { endedBy };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message.slice(0, 160) : String(err);
    endedBy = name === 'TimeoutError' || name === 'AbortError' ? 'deadline' : 'error';
    return { endedBy, error: `${name}: ${message}` };
  }
}
