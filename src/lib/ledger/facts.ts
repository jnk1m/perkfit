import type { Candidate, FitTier } from '@/lib/types';
import { fmtValue } from './fmt';
import type { Ledger } from './ledger';

export interface Fact {
  /** Slot name: f1..f4. */
  key: string;
  /** Plain-English description given to the LLM. */
  label: string;
  field: string;
  entryId: string;
  source: 'qloo' | 'assumption' | 'calc' | 'sample';
  /** The entry is an assumption or depends on one (recursive). */
  assumed: boolean;
  display: string;
}

export interface CandidateFacts {
  candidateId: string;
  name: string;
  domain: Candidate['domain'];
  tier: FitTier;
  facts: Fact[];
}

const FACT_DEFS: { key: string; label: string; field: string; scenario?: 'base' }[] = [
  { key: 'f1', label: 'rank of this perk within its category for this segment', field: 'percentile' },
  { key: 'f2', label: 'assumed share of members using the perk', field: 'usage_rate', scenario: 'base' },
  { key: 'f3', label: 'monthly cost at that assumed share', field: 'monthly_cost', scenario: 'base' },
  { key: 'f4', label: 'number of scenarios in which the perk stays in the bundle', field: 'stability' },
];

const TIERS: readonly string[] = ['high', 'mid', 'low'];

/**
 * Build the fact table for one candidate from the ledger. Returns null when the ledger has no
 * tier for the candidate (it was never scored), because there is nothing to explain.
 */
export function buildCandidateFacts(ledger: Ledger, candidate: Candidate): CandidateFacts | null {
  const tierEntry = ledger.find(candidate.id, 'fit_tier');
  if (!tierEntry || typeof tierEntry.value !== 'string' || !TIERS.includes(tierEntry.value)) return null;

  const facts: Fact[] = [];
  for (const def of FACT_DEFS) {
    const entry = ledger.find(candidate.id, def.field, def.scenario);
    if (!entry) continue;
    facts.push({
      key: def.key,
      label: def.label,
      field: def.field,
      entryId: entry.id,
      source: entry.source,
      assumed: ledger.isAssumed(entry.id),
      display: fmtValue(def.field, entry.value),
    });
  }
  return {
    candidateId: candidate.id,
    name: candidate.name,
    domain: candidate.domain,
    tier: tierEntry.value as FitTier,
    facts,
  };
}
