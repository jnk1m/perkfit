export type PerkfitMode = 'sample' | 'live';

/**
 * Data mode for a deployment. `PERKFIT_MODE=sample` forces sample data.
 * Otherwise a Qloo key means live, and no key means sample, so a fresh clone runs without secrets.
 */
export function resolveMode(env: Record<string, string | undefined> = process.env): PerkfitMode {
  if (env.PERKFIT_MODE === 'sample') return 'sample';
  return env.QLOO_API_KEY ? 'live' : 'sample';
}
