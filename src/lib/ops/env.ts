import 'server-only';
import { z } from 'zod';

const schema = z.object({
  QLOO_API_KEY: z.string().min(1).optional(),
  QLOO_BASE_URL: z.url().default('https://hackathon.api.qloo.com'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  PERKFIT_MODE: z.enum(['live', 'sample']).optional(),
  PERKFIT_LLM_MODEL: z.string().min(1).default('claude-opus-5-5'),
  PERKFIT_PRECACHE: z.string().min(1).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

/**
 * Validates server environment variables. Empty strings count as unset, so a copied `.env.example` works.
 * The error names the variables and the problem, never the values.
 */
export function parseEnv(raw: Record<string, string | undefined>): ServerEnv {
  const picked: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = raw[key];
    if (value !== undefined && value !== '') picked[key] = value;
  }
  const result = schema.safeParse(picked);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
