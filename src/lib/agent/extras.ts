import { z } from 'zod';
import type { AgentTraceStep } from '@/lib/types';
import type { PrecacheLike, RunArtifacts } from './ports';

/** Key inside the Qloo precache `extras` record. */
export const EXTRAS_KEY = 'perkfit';

const templateSchema = z.object({
  candidateId: z.string(),
  tier: z.enum(['high', 'mid', 'low']),
  text: z.string(),
});

const traceSchema = z.object({
  step: z.number(),
  tool: z.string(),
  ok: z.boolean(),
  ms: z.number(),
  qlooCalls: z.number(),
  summary: z.string(),
});

const runExtrasSchema = z.object({
  templates: z.array(templateSchema),
  llmAlone: z
    .object({ status: z.enum(['ok', 'failed']), picks: z.array(z.string()), dropped: z.array(z.string()) })
    .nullable(),
  trace: z.array(traceSchema),
});

const extrasSchema = z.object({
  v: z.literal(1),
  /** Keyed by the engine input hash of the example's default inputs. */
  runs: z.record(z.string(), runExtrasSchema),
});

export type RunExtras = z.infer<typeof runExtrasSchema>;
export type PerkfitExtras = z.infer<typeof extrasSchema>;

/** Pre-verified output for one input hash, or null. A malformed blob is treated as absent, not trusted. */
export function readRunExtras(precache: PrecacheLike | null | undefined, inputHash: string): RunExtras | null {
  const raw = precache?.data.extras[EXTRAS_KEY];
  if (raw === undefined) return null;
  const parsed = extrasSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.runs[inputHash] ?? null;
}

/** Returns a new `extras` record with this run added (existing runs kept). */
export function withRunExtras(
  extras: Record<string, unknown>,
  inputHash: string,
  artifacts: Pick<RunArtifacts, 'templates' | 'llmAlone'> & { trace: AgentTraceStep[] },
): Record<string, unknown> {
  const prev = extrasSchema.safeParse(extras[EXTRAS_KEY]);
  const runs = prev.success ? prev.data.runs : {};
  const next: PerkfitExtras = {
    v: 1,
    runs: {
      ...runs,
      [inputHash]: { templates: artifacts.templates, llmAlone: artifacts.llmAlone, trace: artifacts.trace },
    },
  };
  return { ...extras, [EXTRAS_KEY]: next };
}
