import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';
import type { ZodType } from 'zod';

export type LlmErrorCode = 'timeout' | 'refusal' | 'schema' | 'provider';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmObjectRequest<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Stage name, for error context and test scripts. */
  purpose: 'explain' | 'explain_retry' | 'llm_alone';
}

/** Thin seam over the model so tests can script structured replies without HTTP. */
export interface LlmClient {
  readonly modelId: string;
  generateObject<T>(req: LlmObjectRequest<T>): Promise<T>;
}

export function createAiSdkClient(model: LanguageModel, modelId: string): LlmClient {
  return {
    modelId,
    async generateObject<T>(req: LlmObjectRequest<T>): Promise<T> {
      try {
        const result = await generateText({
          model,
          system: req.system,
          prompt: req.prompt,
          output: Output.object({ schema: req.schema }),
          maxOutputTokens: req.maxOutputTokens,
          // Opus 5.5 always thinks and thinking tokens count against maxOutputTokens. These are small
          // structured fills, so effort is low and callers size maxOutputTokens for thinking plus JSON.
          providerOptions: { anthropic: { effort: 'low' } },
          abortSignal: AbortSignal.timeout(req.timeoutMs),
          maxRetries: 0,
        });
        return result.output as T;
      } catch (err) {
        throw toLlmError(err, req);
      }
    },
  };
}

function toLlmError(err: unknown, req: LlmObjectRequest<unknown>): LlmError {
  if (err instanceof LlmError) return err;
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  const ctx = `${req.purpose} (maxOutputTokens=${req.maxOutputTokens}, timeoutMs=${req.timeoutMs})`;
  if (name === 'TimeoutError' || name === 'AbortError') return new LlmError('timeout', `LLM call timed out: ${ctx}`);
  if (name === 'AI_NoObjectGeneratedError' || name === 'AI_TypeValidationError' || name === 'AI_JSONParseError') {
    return new LlmError('schema', `LLM output did not match the schema: ${ctx}: ${message.slice(0, 200)}`);
  }
  return new LlmError('provider', `LLM call failed: ${ctx}: ${name} ${message.slice(0, 200)}`);
}
