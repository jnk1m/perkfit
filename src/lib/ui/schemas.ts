import { z } from 'zod';
import { AGE_BANDS } from '@/lib/types';
import { CANDIDATES } from '@/data/candidates';

/** Hard cap on request bodies (design 2: input limits). */
export const MAX_BODY_BYTES = 20 * 1024;

const CATALOG_IDS = new Set(CANDIDATES.map((c) => c.id));

const chip = z.object({ token: z.string().min(1).max(160), name: z.string().min(1).max(80) });

const segment = z.object({
  id: z.enum(['example_a', 'example_b', 'custom']),
  label: z.string().min(1).max(80),
  age: z.enum(AGE_BANDS as [string, ...string[]]),
  gender: z.enum(['male', 'female']).optional(),
  interests: z.array(chip).min(1, 'Add at least one interest chip').max(5, 'At most 5 interest chips'),
});

const override = z.object({
  unitCost: z.number().min(0).max(10_000),
  billing: z.enum(['per_use', 'fixed']),
  friction: z.number().min(0.1).max(2),
});

const overrides = z.record(z.string().max(40), override).refine(
  (o) => Object.keys(o).every((k) => CATALOG_IDS.has(k)),
  'candidateOverrides may only reference catalog candidates',
);

const weight = z.number().min(0).max(2);
const usage = z.object({ high: z.number().min(0).max(1), mid: z.number().min(0).max(1), low: z.number().min(0).max(1) });

export const runRequestSchema = z.object({
  mode: z.enum(['live', 'sample']),
  segment,
  candidateOverrides: overrides,
  budget: z.number().gt(0).max(1e9),
  members: z.number().int().min(1).max(1e8),
  domainWeights: z.object({ place: weight, tv_show: weight, brand: weight, book: weight }).partial().optional(),
  usage: usage.optional(),
  includeLlm: z.boolean(),
  answers: z.record(z.string().max(64), z.string().max(160)).refine((a) => Object.keys(a).length <= 8).optional(),
});

export const compareRequestSchema = z.object({
  mode: z.enum(['live', 'sample']),
  against: z.array(z.enum(['example_a', 'example_b', 'example_a_near'])).min(1).max(3),
  candidateOverrides: overrides,
});

export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(80) });

/** First zod issue as "path: message" so the client can point at the field. */
export function firstIssue(err: z.ZodError): { field: string; message: string } {
  const issue = err.issues[0];
  const field = issue.path.join('.');
  return { field, message: field ? `${field}: ${issue.message}` : issue.message };
}
