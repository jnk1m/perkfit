import { MockLanguageModelV4 } from 'ai/test';
import { LlmError } from '@/lib/llm/client';
import type { LlmClient, LlmObjectRequest } from '@/lib/llm/client';

type Reply = unknown | Error | ((req: LlmObjectRequest<unknown>) => unknown);

/**
 * Scripted structured-output client. Each call consumes the next reply. A reply that fails the
 * request's schema throws an LlmError('schema'), like a real model returning bad JSON.
 */
export class FakeLlm implements LlmClient {
  readonly modelId = 'fake-model';
  readonly calls: LlmObjectRequest<unknown>[] = [];
  private readonly replies: Reply[];

  constructor(replies: Reply[]) {
    this.replies = [...replies];
  }

  async generateObject<T>(req: LlmObjectRequest<T>): Promise<T> {
    this.calls.push(req as LlmObjectRequest<unknown>);
    if (this.replies.length === 0) throw new Error(`FakeLlm: no scripted reply left for call ${this.calls.length} (${req.purpose})`);
    const next = this.replies.shift();
    const value = typeof next === 'function' ? (next as (r: LlmObjectRequest<unknown>) => unknown)(req as LlmObjectRequest<unknown>) : next;
    if (value instanceof Error) throw value;
    const parsed = req.schema.safeParse(value);
    if (!parsed.success) throw new LlmError('schema', `FakeLlm reply failed the schema for ${req.purpose}`);
    return parsed.data;
  }
}

export const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export interface ScriptedCall {
  name: string;
  input: Record<string, unknown>;
}

let counter = 0;

/** One model step that calls tools. */
export function toolStep(...calls: ScriptedCall[]) {
  return {
    content: calls.map((c) => ({
      type: 'tool-call' as const,
      toolCallId: `call-${++counter}`,
      toolName: c.name,
      input: JSON.stringify(c.input),
    })),
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage,
    warnings: [],
  };
}

/** A final text step. */
export function textStep(text = 'done') {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage,
    warnings: [],
  };
}

/** Loop model that replays the given steps, then keeps returning a text step. */
export function mockLoopModel(steps: ReturnType<typeof toolStep | typeof textStep>[]) {
  let i = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => (i < steps.length ? steps[i++] : textStep('finished')),
  });
  return model;
}

/** A valid two-sentence template for every perk in an explain prompt (reads the slots it was offered). */
export function templateFromPrompt(req: LlmObjectRequest<unknown>, tweak?: (item: { candidateId: string; tier: string; text: string }) => void) {
  const payload = JSON.parse(req.prompt) as { perks: { candidateId: string; tier: string; facts: { slot: string }[] }[] };
  return {
    items: payload.perks.map((p) => {
      const has = (k: string) => p.facts.some((f) => f.slot === k);
      const first = has('f1') ? '{name} sits at {f1} within {domain} for this segment, a {tier} taste fit.' : '{name} is a {tier} taste fit within {domain} for this segment.';
      const second = has('f2') && has('f3') ? ' The {f3} monthly cost rests on an assumed usage rate of {f2}.' : '';
      const item = { candidateId: p.candidateId, tier: p.tier, text: first + second };
      tweak?.(item);
      return item;
    }),
  };
}
