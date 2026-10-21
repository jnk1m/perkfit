import { tool } from 'ai';
import { z } from 'zod';
import { DOMAINS } from '@/lib/types';
import {
  askUserOp,
  explainOp,
  holdoutPlanOp,
  llmAloneOp,
  optimizeBundleOp,
  readPopularityOp,
  resolveCandidateOp,
  resolveChipOp,
  scoreDomainOp,
  type OpOut,
} from './ops';
import type { RunSession } from './session';

const domain = z.enum(DOMAINS as unknown as [string, ...string[]]);
const token = z.string().min(1).max(200);
/** Alternative search name for a perk the first search could not match. Plain text only. */
const altQuery = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[\p{L}\p{N} .,'&:!-]+$/u, 'letters, digits, spaces and . , \' & : ! - only');

const out = (r: OpOut) => ({ ok: r.ok, ...r.data });

/**
 * The nine agent tools. Inputs are validated by zod before `execute` runs. Every tool delegates to a
 * plain operation in ops.ts, so the model can reorder or skip steps but cannot change a number.
 */
export function createTools(s: RunSession) {
  return {
    resolve_chip: tool({
      description:
        'Check that one interest chip of the segment maps to a Qloo entity. Returns resolved, ambiguous (with options) or no_match. Call once per chip before scoring.',
      inputSchema: z.object({ token }),
      execute: async ({ token: t }) => out(await resolveChipOp(s, t)),
    }),
    resolve_candidate: tool({
      description:
        'Retry matching a perk that came back without a Qloo score (no_data or no_match). Optionally give an alternative spelling or name to search. At most 2 retries per run. If it resolves, the perk\'s domain is scored again.',
      inputSchema: z.object({ candidateId: z.string().min(1).max(60), query: altQuery.optional() }),
      execute: async ({ candidateId, query }) => out(await resolveCandidateOp(s, candidateId, query)),
    }),
    score_domain: tool({
      description:
        'Score all perks of one domain for the segment with one Qloo call. Call for each of place, tv_show, brand and book. Safe to call the four domains in the same step.',
      inputSchema: z.object({ domain }),
      execute: async ({ domain: d }) => out(await scoreDomainOp(s, d as (typeof DOMAINS)[number])),
    }),
    read_popularity: tool({
      description: 'Report how many perks per domain have a popularity value and how tightly the values cluster. Informational.',
      inputSchema: z.object({}),
      execute: async () => out(readPopularityOp(s)),
    }),
    optimize_bundle: tool({
      description:
        'Compute percentiles, tiers, the budget-limited bundle and the headline from the scores. Needs all four domains scored. Emits the scores to the client.',
      inputSchema: z.object({}),
      execute: async () => out(optimizeBundleOp(s)),
    }),
    llm_alone: tool({
      description:
        'Ask a plain LLM pick (no Qloo data) for the comparison card. Independent of scoring, so it can run in the same step as score_domain.',
      inputSchema: z.object({}),
      execute: async () => out(await llmAloneOp(s)),
    }),
    explain: tool({
      description:
        'Write one verified explanation per bundle perk and per skipped perk. The text is a slot template checked against the evidence ledger; you choose nothing here. Needs optimize_bundle first.',
      inputSchema: z.object({}),
      execute: async () => out(await explainOp(s)),
    }),
    holdout_plan: tool({
      description: 'Prepare the holdout test plan rows for the bundle. Needs optimize_bundle first.',
      inputSchema: z.object({}),
      execute: async () => out(holdoutPlanOp(s)),
    }),
    ask_user: tool({
      description:
        'Stop and ask the user to pick the right match for a chip that resolve_chip reported as ambiguous. The run ends here and resumes after the answer.',
      inputSchema: z.object({ token }),
      execute: async ({ token: t }) => out(askUserOp(s, t)),
    }),
  };
}

export type PerkFitTools = ReturnType<typeof createTools>;
export const TOOL_NAMES = [
  'resolve_chip',
  'resolve_candidate',
  'score_domain',
  'read_popularity',
  'optimize_bundle',
  'llm_alone',
  'explain',
  'holdout_plan',
  'ask_user',
] as const;
