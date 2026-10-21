import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmError, createAiSdkClient } from '@/lib/llm/client';
import { usage } from '../helpers/fake-llm';

const schema = z.object({ ranked: z.array(z.string()) });
const req = { system: 's', prompt: 'p', schema, maxOutputTokens: 100, timeoutMs: 1000, purpose: 'llm_alone' as const };

const textModel = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    }),
  });

describe('createAiSdkClient', () => {
  it('returns the schema-validated object and sends no temperature', async () => {
    const model = textModel('{"ranked":["a","b"]}');
    const out = await createAiSdkClient(model, 'mock').generateObject(req);
    expect(out).toEqual({ ranked: ['a', 'b'] });
    const call = model.doGenerateCalls[0];
    expect(call.temperature).toBeUndefined();
    expect(call.maxOutputTokens).toBe(100);
  });

  it('maps a reply that does not match the schema to LlmError schema', async () => {
    const err = await createAiSdkClient(textModel('{"ranked":"nope"}'), 'mock').generateObject(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe('schema');
    expect(err.message).toContain('llm_alone');
  });

  it('maps a provider failure to LlmError provider and keeps context in the message', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('boom');
      },
    });
    const err = await createAiSdkClient(model, 'mock').generateObject(req).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe('provider');
    expect(err.message).toMatch(/llm_alone.*maxOutputTokens=100.*timeoutMs=1000/);
  });

  it('maps an exceeded timeout to LlmError timeout', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
        }),
    });
    const err = await createAiSdkClient(model, 'mock').generateObject({ ...req, timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe('timeout');
  });
});
