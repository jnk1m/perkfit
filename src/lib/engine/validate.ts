import { DOMAINS } from '@/lib/types';
import type { CandidateScore, RunInput } from '@/lib/types';
import type { EngineConfig } from './types';

/** Thrown for invalid engine input. Carries the field name and the offending value. */
export class EngineInputError extends Error {
  readonly field: string;
  readonly value: unknown;
  constructor(field: string, value: unknown, reason: string) {
    super(`Invalid engine input: ${field} ${reason} (got ${typeof value === 'number' ? String(value) : JSON.stringify(value)})`);
    this.name = 'EngineInputError';
    this.field = field;
    this.value = value;
  }
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Validate the run input and score rows. Never coerces silently. */
export function validateRunInput(input: RunInput, scores: readonly CandidateScore[]): void {
  if (!isNum(input.budget) || input.budget <= 0) throw new EngineInputError('budget', input.budget, 'must be a number > 0');
  if (!isNum(input.members) || !Number.isInteger(input.members) || input.members < 1) {
    throw new EngineInputError('members', input.members, 'must be an integer >= 1');
  }
  const seen = new Set<string>();
  for (const c of input.candidates) {
    if (seen.has(c.id)) throw new EngineInputError('candidates.id', c.id, 'is duplicated');
    seen.add(c.id);
    if (!(DOMAINS as readonly string[]).includes(c.domain)) throw new EngineInputError(`candidates.${c.id}.domain`, c.domain, 'is not a known domain');
    if (c.billing !== 'per_use' && c.billing !== 'fixed') throw new EngineInputError(`candidates.${c.id}.billing`, c.billing, 'must be per_use or fixed');
    if (!isNum(c.unitCost) || c.unitCost < 0) throw new EngineInputError(`candidates.${c.id}.unitCost`, c.unitCost, 'must be a number >= 0');
    if (!isNum(c.friction) || c.friction < 0) throw new EngineInputError(`candidates.${c.id}.friction`, c.friction, 'must be a number >= 0');
  }
  for (const [d, w] of Object.entries(input.domainWeights ?? {})) {
    if (w === undefined) continue;
    if (!isNum(w) || w < 0) throw new EngineInputError(`domainWeights.${d}`, w, 'must be a number >= 0');
  }
  const seenScore = new Set<string>();
  for (const s of scores) {
    if (!seen.has(s.candidateId)) throw new EngineInputError('scores.candidateId', s.candidateId, 'does not match any candidate');
    if (seenScore.has(s.candidateId)) throw new EngineInputError('scores.candidateId', s.candidateId, 'has more than one score row');
    seenScore.add(s.candidateId);
  }
}

/** Validate a fully merged config. */
export function validateConfig(cfg: EngineConfig): void {
  for (const [k, v] of Object.entries(cfg.tierUsage)) {
    if (!isNum(v) || v < 0 || v > 1) throw new EngineInputError(`tierUsage.${k}`, v, 'must be between 0 and 1');
  }
  for (const [k, v] of Object.entries(cfg.scenarioMult)) {
    if (!isNum(v) || v < 0) throw new EngineInputError(`scenarioMult.${k}`, v, 'must be a number >= 0');
  }
  const { low, high } = cfg.cuts;
  if (!isNum(low) || !isNum(high) || low < 0 || high > 1 || low > high) {
    throw new EngineInputError('cuts', cfg.cuts, 'must satisfy 0 <= low <= high <= 1');
  }
  if (!isNum(cfg.quantUnit) || cfg.quantUnit <= 0) throw new EngineInputError('quantUnit', cfg.quantUnit, 'must be a number > 0');
  if (!isNum(cfg.holdout.share) || cfg.holdout.share <= 0 || cfg.holdout.share > 1) {
    throw new EngineInputError('holdout.share', cfg.holdout.share, 'must be in (0, 1]');
  }
  if (!isNum(cfg.holdout.weeks) || cfg.holdout.weeks < 1) throw new EngineInputError('holdout.weeks', cfg.holdout.weeks, 'must be >= 1');
  if (!isNum(cfg.smallSavingRatio) || cfg.smallSavingRatio < 0) throw new EngineInputError('smallSavingRatio', cfg.smallSavingRatio, 'must be >= 0');
  if (!isNum(cfg.sensitivityDelta) || cfg.sensitivityDelta < 0) throw new EngineInputError('sensitivityDelta', cfg.sensitivityDelta, 'must be >= 0');
}
