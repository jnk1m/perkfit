import { z } from 'zod';
import type { ExplanationItem } from '@/lib/api/types';
import { DOMAIN_LABEL, type CandidateFacts } from '@/lib/ledger';
import type { LlmClient } from './client';
import {
  RULE_DESCRIPTIONS,
  countRules,
  emptyStats,
  renderTemplate,
  validateTemplate,
  type RuleId,
  type TemplateItem,
  type ValidationStats,
} from './validator';

export const explainSchema = z.object({
  items: z.array(
    z.object({
      candidateId: z.string(),
      tier: z.enum(['high', 'mid', 'low']),
      text: z.string(),
    }),
  ),
});
export type ExplainOutput = z.infer<typeof explainSchema>;

export const EXPLAIN_SYSTEM = `You write one short explanation per partner perk for a decision tool.
The tool compares perks by taste fit for a customer segment (never for individuals) and shows the result with its evidence.

Hard rules:
- Output a slot template, not final text. You cannot write numbers or perk names. The program fills them in.
- Allowed slots: {name}, {domain}, {tier}, and the fact slots listed for that perk (for example {f1}). Use no other braces.
- Every text must contain {name}. Repeat the given tier in the "tier" field exactly.
- Outside slots, write no digits, no %, no $, and no number words (one, two, ten, half, double, percent...).
- At most 2 sentences and 40 words.
- A sentence that uses a fact marked assumed=true must contain the word "assumed" and must not contain the word "Qloo".
- A sentence that uses {tier} or a fact marked assumed=false must not contain the word "assumed".
- Never predict behavior, and never mention credit, income, risk, probability, causes or individuals. Do not say "because".
- Describe taste fit as high, mid or low. Do not say any perk is good or bad for the budget; costs are assumptions.

Example for a perk with facts f1 (assumed=false), f2 and f3 (assumed=true):
{name} sits at {f1} within {domain} for this segment, a {tier} taste fit. The {f3} monthly cost rests on an assumed usage rate of {f2}.

Choose which facts to cite for each perk. Vary the wording a little between perks.`;

const RETRY_NOTE =
  'The previous template for each perk below broke the listed rules. Write a new template for each. The earlier text is not shown on purpose.';

export interface ExplainRunOptions {
  client: LlmClient;
  segmentId: string;
  targets: CandidateFacts[];
  /** Per-call timeout in ms; called just before each LLM call. */
  timeoutMs: () => number;
  /** Returns false when the run's LLM call budget is spent. Called once per LLM call. */
  gate: () => boolean;
}

export interface ExplainOutcome {
  items: ExplanationItem[];
  /** Verified slot templates, reusable against a later ledger (precache extras, sample mode). */
  templates: TemplateItem[];
  stats: ValidationStats;
  /** `failed`: the first call did not produce a usable object; all items are code fact sentences. */
  llm: 'ok' | 'failed';
  llmCalls: number;
  error?: string;
}

function userPayload(targets: CandidateFacts[], segmentId: string, violations?: Map<string, RuleId[]>): string {
  return JSON.stringify({
    segment: segmentId,
    ...(violations ? { note: RETRY_NOTE } : {}),
    perks: targets.map((t) => ({
      candidateId: t.candidateId,
      tier: t.tier,
      facts: t.facts.map((f) => ({
        slot: f.key,
        meaning: f.label,
        source: f.source,
        assumed: f.assumed,
        value: f.display,
      })),
      ...(violations
        ? {
            violations: (violations.get(t.candidateId) ?? []).map((r) => ({ rule: r, requirement: RULE_DESCRIPTIONS[r] })),
          }
        : {}),
    })),
  });
}

/** Code-only sentence used when the LLM step is unavailable. Built from the ledger facts, no model text. */
export function factSentence(t: CandidateFacts): string {
  const f1 = t.facts.find((f) => f.key === 'f1');
  const tail = f1 ? `, ${f1.display} in its category` : '';
  return `${t.name}: ${t.tier} taste fit${tail}.`;
}

function asItem(t: CandidateFacts, sentence: string): ExplanationItem {
  return { candidateId: t.candidateId, sentence, status: 'verified', failedRules: [] };
}

function discardedItem(candidateId: string, rules: RuleId[]): ExplanationItem {
  return { candidateId, sentence: null, status: 'discarded', failedRules: rules };
}

/** Validate templates against targets without any LLM call (cache replay, sample mode). */
export function applyTemplates(
  targets: CandidateFacts[],
  templates: readonly TemplateItem[],
): { items: ExplanationItem[]; verified: TemplateItem[]; missing: number } {
  const byId = new Map(templates.map((t) => [t.candidateId, t]));
  const items: ExplanationItem[] = [];
  const verified: TemplateItem[] = [];
  let missing = 0;
  for (const t of targets) {
    const tpl = byId.get(t.candidateId);
    if (!tpl) {
      missing += 1;
      items.push(asItem(t, factSentence(t)));
      continue;
    }
    const v = validateTemplate(tpl, t);
    if (v.ok) {
      verified.push(tpl);
      items.push(asItem(t, renderTemplate(tpl.text, t, DOMAIN_LABEL[t.domain])));
    } else {
      // Stale template (for example the tier moved after an edit): fall back to the code sentence.
      items.push(asItem(t, factSentence(t)));
    }
  }
  return { items, verified, missing };
}

export async function runExplain(opts: ExplainRunOptions): Promise<ExplainOutcome> {
  const { client, targets, segmentId } = opts;
  const stats = emptyStats(targets.length);
  const templates = new Map<string, TemplateItem>();
  const failedRules = new Map<string, RuleId[]>();
  let llmCalls = 0;

  const call = async (
    subset: CandidateFacts[],
    purpose: 'explain' | 'explain_retry',
    violations?: Map<string, RuleId[]>,
  ): Promise<ExplainOutput | null> => {
    if (!opts.gate()) throw new Error('LLM call budget exhausted');
    llmCalls += 1;
    try {
      return await client.generateObject({
        system: EXPLAIN_SYSTEM,
        prompt: userPayload(subset, segmentId, violations),
        schema: explainSchema,
        maxOutputTokens: purpose === 'explain' ? 6000 : 3000,
        timeoutMs: opts.timeoutMs(),
        purpose,
      });
    } catch (err) {
      if (purpose === 'explain') throw err;
      return null;
    }
  };

  const check = (subset: CandidateFacts[], out: ExplainOutput | null, firstPass: boolean) => {
    const byId = new Map<string, TemplateItem>();
    for (const it of out?.items ?? []) if (!byId.has(it.candidateId)) byId.set(it.candidateId, it);
    for (const t of subset) {
      const res = validateTemplate(byId.get(t.candidateId), t);
      if (res.ok) {
        templates.set(t.candidateId, byId.get(t.candidateId)!);
        failedRules.delete(t.candidateId);
        if (firstPass) stats.passedFirst += 1;
        else stats.repaired += 1;
      } else {
        failedRules.set(t.candidateId, res.rules);
      }
    }
  };

  // First pass
  let first: ExplainOutput | null;
  try {
    first = await call(targets, 'explain');
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      items: targets.map((t) => asItem(t, factSentence(t))),
      templates: [],
      stats: { ...stats, discarded: 0 },
      llm: 'failed',
      llmCalls,
      error,
    };
  }
  check(targets, first, true);

  // One repair pass for failures only
  const failed = targets.filter((t) => failedRules.has(t.candidateId));
  if (failed.length > 0) {
    const violations = new Map(failed.map((t) => [t.candidateId, failedRules.get(t.candidateId)!]));
    let second: ExplainOutput | null = null;
    try {
      second = await call(failed, 'explain_retry', violations);
    } catch {
      second = null; // budget spent: keep the first-pass verdict
    }
    if (second) check(failed, second, false);
  }

  const items: ExplanationItem[] = targets.map((t) => {
    const tpl = templates.get(t.candidateId);
    if (tpl) return { candidateId: t.candidateId, sentence: renderTemplate(tpl.text, t, DOMAIN_LABEL[t.domain]), status: 'verified', failedRules: [] };
    const rules = failedRules.get(t.candidateId) ?? ['V0'];
    countRules(stats, rules);
    stats.discarded += 1;
    return discardedItem(t.candidateId, rules);
  });

  return { items, templates: [...templates.values()], stats, llm: 'ok', llmCalls };
}
