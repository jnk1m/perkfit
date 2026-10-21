import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export const DEFAULT_MODEL_ID = 'claude-opus-5-5';

export function getModelId(): string {
  return process.env.PERKFIT_LLM_MODEL?.trim() || DEFAULT_MODEL_ID;
}

/**
 * The only place that picks a provider. Opus 5.5 rejects non-default `temperature`,
 * so callers never set it; determinism comes from input-hash caches.
 */
export function getModel(): LanguageModel {
  return anthropic(getModelId());
}
