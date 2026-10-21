/**
 * Engine-local types. Shared types (Candidate, CandidateScore, Headline, LedgerEntry, ...) live in
 * `@/lib/types` and are imported, never redefined. This module is pure: no server-only, no Node APIs.
 */
import type { Billing, Domain, FitTier, Headline, LedgerEntry, Scenario } from '@/lib/types';

export type { Headline };

/** Every field is an editable assumption. */
export interface EngineConfig {
  /** Assumed share of members using a perk, by taste-fit tier. */
  tierUsage: Record<FitTier, number>;
  scenarioMult: Record<Scenario, number>;
  /** Percentile cuts: p < low is tier low, p >= high is tier high. */
  cuts: { low: number; high: number };
  /** Costs are rounded up to this many dollars for the bundle search. */
  quantUnit: number;
  holdout: { share: number; weeks: number };
  /** Headline kind is `skip_small` when the saving is under this share of the budget. */
  smallSavingRatio: number;
  /** Both cuts are shifted by +/- this amount for the sensitivity check. */
  sensitivityDelta: number;
}

export interface PerkScore {
  candidateId: string;
  name: string;
  domain: Domain;
  billing: Billing;
  affinity: number;
  /** 1-based mid-rank within the domain, ascending by affinity. */
  rank: number;
  domainN: number;
  percentile: number;
  tier: FitTier;
  popularityPercentile: number | null;
  popularity: number | null;
  scn: Record<Scenario, { usageRate: number; monthlyCost: number; value: number }>;
}

export interface DeferredPerk {
  candidateId: string;
  name: string;
  domain: Domain;
  reason: 'no_data' | 'no_match';
  /** Cost at the mid-tier usage rate (same as `neutralCost`), so evaluations can still price it. */
  neutralCost: number;
}

export interface Bundle {
  scenario: Scenario | 'popularity';
  perkIds: string[];
  totalCost: number;
  totalValue: number;
  budgetUsedRatio: number;
}

export interface BundleSet {
  byScenario: Record<Scenario, Bundle>;
  /** In how many of the three scenario bundles each perk appears. */
  inScenarioCount: Record<string, 0 | 1 | 2 | 3>;
  stableIds: string[];
  /** |intersection of the three| / |base bundle|; null when the base bundle is empty. */
  stability: number | null;
}

export interface BundleDiff {
  /** Perks of A that are not in B. */
  n: number;
  /** Size of A. */
  m: number;
  kept: string[];
  dropped: string[];
  added: string[];
}

export interface CompareResult {
  diff: BundleDiff;
  rho: number | null;
  rhoN: number;
}

export interface BundleEval {
  cost: number;
  withinBudget: boolean;
  totalValue: number;
  lowFitIds: string[];
  unscoredIds: string[];
  unknownIds: string[];
}

export interface SegmentCompare extends CompareResult {
  aId: string;
  bId: string;
}

export interface SensitivityResult {
  retained: number | null;
  variants: { delta: number; perkIds: string[]; retained: number }[];
}

export interface HoldoutRow {
  candidateId: string;
  tier: FitTier;
  hypothesis: string;
  holdoutShare: number;
  holdoutMembers: number;
  weeks: number;
  metric: string;
  roiFormula: string;
  successRule: string;
}

export type EngineWarningCode =
  | 'thin_domain'
  | 'domain_empty'
  | 'missing_score'
  | 'ok_without_affinity'
  | 'popularity_ties'
  | 'over_budget_single'
  | 'zero_cost'
  | 'budget_below_unit';

export interface EngineWarning {
  code: EngineWarningCode;
  ids?: string[];
  domain?: Domain;
}

export interface RunResult {
  segmentId: string;
  budget: number;
  members: number;
  config: EngineConfig;
  perks: PerkScore[];
  deferred: DeferredPerk[];
  bundle: BundleSet;
  baseline: Bundle;
  headline: Headline;
  compare: {
    vsPopularity: CompareResult;
    /** Filled by the orchestrator with `compareBundles`. */
    vsLlm?: CompareResult & { eval: BundleEval };
    /** Filled by the orchestrator with `compareSegments`. */
    vsSegments?: SegmentCompare[];
  };
  sensitivity: SensitivityResult;
  holdout: HoldoutRow[];
  /** `calc` and `assumption` entries only; Qloo entries are added by the ledger module. */
  ledger: LedgerEntry[];
  warnings: EngineWarning[];
}

export interface RunOptions {
  /** Added to every ledger `seq`, so the ledger module can append engine entries after its Qloo entries. */
  seqOffset?: number;
}
