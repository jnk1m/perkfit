import { z } from 'zod';

/** Only the fields we read; everything else is stripped. Shapes match the real responses (names only here). */

const explainItem = z.object({ entity_id: z.string(), score: z.number() });

const searchHit = z.object({
  entity_id: z.string().min(1),
  name: z.string(),
  types: z.array(z.string()).default([]),
  popularity: z.number().nullish(),
  disambiguation: z.string().nullish(),
  properties: z
    .object({
      geocode: z.object({ city: z.string().nullish(), metro: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

/** /search: `results[]`, no top-level `success`, `types` plural. */
export const searchResponseSchema = z.object({ results: z.array(searchHit) });

const insightsEntity = z.object({
  entity_id: z.string().min(1),
  name: z.string(),
  subtype: z.string().nullish(),
  popularity: z.number().nullish(),
  query: z
    .object({
      // Range and type are judged per candidate by the scorer, so accept anything here.
      affinity: z.unknown().optional(),
      // The key contains literal dots; it is not a nested path.
      explainability: z.object({ 'signal.interests.entities': z.array(explainItem).optional() }).nullish(),
    })
    .nullish(),
});

/** /v2/insights: `success` plus `results.entities[]`. */
export const insightsResponseSchema = z.object({
  success: z.boolean().optional(),
  results: z.object({ entities: z.array(insightsEntity) }),
});

/** Error bodies: `errors[].message`. */
export const errorResponseSchema = z.object({ errors: z.array(z.object({ message: z.string() })).min(1) });

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type InsightsResponse = z.infer<typeof insightsResponseSchema>;

/** Schema issue paths only, never values. Array indexes are collapsed so the detail stays short. */
export function issuePaths(error: z.ZodError, max = 3): string {
  const paths = new Set(error.issues.map((i) => i.path.map((p) => (typeof p === 'number' ? '[]' : String(p))).join('.')));
  return [...paths].slice(0, max).join(',');
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Names from Qloo sometimes carry HTML entities such as `&amp;`. */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}
