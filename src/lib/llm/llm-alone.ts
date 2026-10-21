import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Candidate, Segment } from '@/lib/types';
import type { LlmClient } from './client';

export const LLM_ALONE_PROMPT_VERSION = 'llm-alone-v1';

export const LLM_ALONE_SYSTEM = `You pick partner perks for a membership program.
You get a customer segment (age band, optional gender, a few interest names), a budget, a member count, and a list of candidate perks with an estimated monthly cost each.
Return the candidate ids ordered from the perk you would offer first to the one you would offer last, using only the ids you were given.
Think about which perks suit the segment's tastes. Costs and the budget are fixed facts.`;

export interface LlmAloneInput {
  segment: Segment;
  candidates: Candidate[];
  /** Monthly cost per candidate at neutral assumptions, computed by code. */
  neutralCosts: Record<string, number>;
  budget: number;
  members: number;
}

export interface LlmAloneResult {
  bundleIds: string[];
  droppedOverBudget: string[];
  unknownIds: number;
  cached: boolean;
  promptHash: string;
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);

function normalizedInput(input: LlmAloneInput) {
  return {
    segment: {
      age: input.segment.age,
      gender: input.segment.gender ?? null,
      interests: input.segment.interests.map((i) => clean(i.name)),
    },
    budget: input.budget,
    members: input.members,
    candidates: input.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain,
      billing: c.billing,
      monthlyCost: Math.round((input.neutralCosts[c.id] ?? 0) * 100) / 100,
    })),
  };
}

export function llmAloneHash(input: LlmAloneInput, modelId: string): string {
  return createHash('sha256')
    .update(JSON.stringify([LLM_ALONE_PROMPT_VERSION, modelId, normalizedInput(input)]))
    .digest('hex');
}

/** Greedy budget fill, in the model's order. Unknown and repeated ids are dropped and counted. */
export function fillBudget(
  ranked: readonly string[],
  input: Pick<LlmAloneInput, 'candidates' | 'neutralCosts' | 'budget'>,
): { bundleIds: string[]; droppedOverBudget: string[]; unknownIds: number } {
  const known = new Set(input.candidates.map((c) => c.id));
  const seen = new Set<string>();
  const bundleIds: string[] = [];
  const droppedOverBudget: string[] = [];
  let unknownIds = 0;
  let spent = 0;
  for (const id of ranked) {
    if (!known.has(id) || seen.has(id)) {
      unknownIds += 1;
      continue;
    }
    seen.add(id);
    const cost = input.neutralCosts[id] ?? 0;
    if (spent + cost <= input.budget) {
      bundleIds.push(id);
      spent += cost;
    } else {
      droppedOverBudget.push(id);
    }
  }
  return { bundleIds, droppedOverBudget, unknownIds };
}

/** In-process cache keyed by input hash. Bounded: the oldest entry goes first. */
export class LlmAloneCache {
  private readonly map = new Map<string, LlmAloneResult>();
  constructor(private readonly maxEntries = 200) {}
  get(key: string): LlmAloneResult | undefined {
    return this.map.get(key);
  }
  set(key: string, value: LlmAloneResult): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
  get size(): number {
    return this.map.size;
  }
}

export const defaultLlmAloneCache = new LlmAloneCache();

export interface RunLlmAloneOptions {
  client: LlmClient;
  input: LlmAloneInput;
  timeoutMs: () => number;
  gate: () => boolean;
  cache?: LlmAloneCache;
}

export async function runLlmAlone(opts: RunLlmAloneOptions): Promise<LlmAloneResult> {
  const { client, input } = opts;
  const cache = opts.cache ?? defaultLlmAloneCache;
  const promptHash = llmAloneHash(input, client.modelId);
  const hit = cache.get(promptHash);
  if (hit) return { ...hit, cached: true };

  const idEnum = input.candidates.map((c) => c.id);
  if (idEnum.length === 0) {
    return { bundleIds: [], droppedOverBudget: [], unknownIds: 0, cached: false, promptHash };
  }
  const schema = z.object({ ranked: z.array(z.enum(idEnum as [string, ...string[]])).max(idEnum.length * 2) });

  if (!opts.gate()) throw new Error('LLM call budget exhausted');
  const out = await client.generateObject({
    system: LLM_ALONE_SYSTEM,
    prompt: JSON.stringify(normalizedInput(input)),
    schema,
    maxOutputTokens: 2000,
    timeoutMs: opts.timeoutMs(),
    purpose: 'llm_alone',
  });
  const filled = fillBudget(out.ranked, input);
  const result: LlmAloneResult = { ...filled, cached: false, promptHash };
  cache.set(promptHash, result);
  return result;
}
