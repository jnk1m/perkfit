import { DOMAINS, SCENARIOS } from '@/lib/types';
import type { CandidateScore, Domain, FitTier, RunInput, Scenario } from '@/lib/types';
import type {
  Bundle,
  BundleSet,
  DeferredPerk,
  EngineConfig,
  EngineWarning,
  PerkScore,
  RunOptions,
  RunResult,
} from './types';
import { mergeConfig } from './config';
import { validateRunInput } from './validate';
import { midRankPercentiles, tierOf } from './percentile';
import { fitValue, monthlyCost, neutralCost, usageRate } from './cost';
import { solveKnapsack } from './knapsack';
import { popularityBaseline } from './baseline';
import { buildHeadline } from './headline';
import { diffBundles, spearman } from './compare';
import { sensitivity } from './sensitivity';
import type { SensitivityItem } from './sensitivity';
import { buildHoldout } from './holdout';
import { buildLedger } from './ledger';
import { cmpStr, sortIds, sum } from './util';

/**
 * Run the whole engine for one segment: percentiles and tiers, costs under three scenarios, three
 * bundles, the popularity-order baseline, the headline, comparison, sensitivity, holdout rows and ledger.
 * Pure and deterministic; input order does not matter. Throws `EngineInputError` on invalid input.
 */
export function runEngine(
  input: RunInput,
  scores: readonly CandidateScore[],
  config?: Partial<EngineConfig>,
  opts: RunOptions = {},
): RunResult {
  const cfg = mergeConfig(config);
  validateRunInput(input, scores);
  const { budget, members } = input;
  const weightOf = (d: Domain): number => input.domainWeights?.[d] ?? 1;
  const cands = [...input.candidates].sort((a, b) => cmpStr(a.id, b.id));
  const scoreById = new Map(scores.map((s) => [s.candidateId, s]));
  const warnings: EngineWarning[] = [];

  // 1. Split into scored and deferred.
  const missing: string[] = [];
  const noAffinity: string[] = [];
  const deferred: DeferredPerk[] = [];
  const scored: { c: (typeof cands)[number]; affinity: number; popularity: number | null }[] = [];
  for (const c of cands) {
    const s = scoreById.get(c.id);
    const defer = (reason: 'no_data' | 'no_match') =>
      deferred.push({ candidateId: c.id, name: c.name, domain: c.domain, reason, neutralCost: neutralCost(c, members, cfg) });
    if (!s) {
      missing.push(c.id);
      defer('no_data');
    } else if (s.status === 'no_match') {
      defer('no_match');
    } else if (s.status === 'no_data') {
      defer('no_data');
    } else if (typeof s.affinity !== 'number' || !Number.isFinite(s.affinity)) {
      noAffinity.push(c.id);
      defer('no_data');
    } else {
      const pop = typeof s.popularity === 'number' && Number.isFinite(s.popularity) ? s.popularity : null;
      scored.push({ c, affinity: s.affinity, popularity: pop });
    }
  }
  if (missing.length) warnings.push({ code: 'missing_score', ids: missing });
  if (noAffinity.length) warnings.push({ code: 'ok_without_affinity', ids: noAffinity });

  // 2. Percentiles and tiers per domain.
  const perks: PerkScore[] = [];
  const sens: SensitivityItem[] = [];
  for (const d of DOMAINS) {
    const group = scored.filter((x) => x.c.domain === d);
    if (group.length === 0) {
      if (cands.some((c) => c.domain === d)) warnings.push({ code: 'domain_empty', domain: d });
      continue;
    }
    if (group.length <= 2) warnings.push({ code: 'thin_domain', domain: d });
    const { rank, p } = midRankPercentiles(group.map((x) => x.affinity));
    const popIdx = group.map((x, i) => (x.popularity === null ? -1 : i)).filter((i) => i >= 0);
    const pop = midRankPercentiles(popIdx.map((i) => group[i].popularity as number));
    const popP = new Map(popIdx.map((gi, k) => [gi, pop.p[k]]));
    group.forEach((x, i) => {
      const tier: FitTier = tierOf(p[i], cfg.cuts);
      const scn = {} as PerkScore['scn'];
      for (const s of SCENARIOS as readonly Scenario[]) {
        const u = usageRate(tier, x.c.friction, s, cfg);
        scn[s] = { usageRate: u, monthlyCost: monthlyCost(x.c, members, u), value: fitValue(weightOf(d), p[i], members, u) };
      }
      perks.push({
        candidateId: x.c.id, name: x.c.name, domain: d, billing: x.c.billing, affinity: x.affinity,
        rank: rank[i], domainN: group.length, percentile: p[i], tier,
        popularityPercentile: popP.get(i) ?? null, popularity: x.popularity, scn,
      });
      sens.push({ id: x.c.id, billing: x.c.billing, domain: d, unitCost: x.c.unitCost, friction: x.c.friction, weight: weightOf(d), percentile: p[i] });
    });
  }
  perks.sort((a, b) => cmpStr(a.candidateId, b.candidateId));
  sens.sort((a, b) => cmpStr(a.id, b.id));

  // 3. Three scenario bundles.
  const byScenario = {} as Record<Scenario, Bundle>;
  let baseKnap = solveKnapsack([], budget, cfg.quantUnit);
  for (const s of SCENARIOS as readonly Scenario[]) {
    const knap = solveKnapsack(
      perks.map((p) => ({ id: p.candidateId, cost: p.scn[s].monthlyCost, value: p.scn[s].value / members })),
      budget,
      cfg.quantUnit,
    );
    if (s === 'base') baseKnap = knap;
    const chosen = new Set(knap.ids);
    const picked = perks.filter((p) => chosen.has(p.candidateId));
    const totalCost = sum(picked.map((p) => p.scn[s].monthlyCost));
    byScenario[s] = {
      scenario: s,
      perkIds: knap.ids,
      totalCost,
      totalValue: sum(picked.map((p) => p.scn[s].value)),
      budgetUsedRatio: totalCost / budget,
    };
  }
  if (baseKnap.overBudgetSingle.length) warnings.push({ code: 'over_budget_single', ids: baseKnap.overBudgetSingle });
  if (baseKnap.zeroCost.length) warnings.push({ code: 'zero_cost', ids: baseKnap.zeroCost });
  if (baseKnap.budgetBelowUnit) warnings.push({ code: 'budget_below_unit' });

  const sets = SCENARIOS.map((s) => new Set(byScenario[s].perkIds));
  const inScenarioCount: Record<string, 0 | 1 | 2 | 3> = {};
  for (const p of perks) inScenarioCount[p.candidateId] = sets.filter((x) => x.has(p.candidateId)).length as 0 | 1 | 2 | 3;
  const baseIds = byScenario.base.perkIds;
  const stableIds = sortIds(baseIds.filter((id) => sets.every((x) => x.has(id))));
  const bundle: BundleSet = {
    byScenario,
    inScenarioCount,
    stableIds,
    stability: baseIds.length ? stableIds.length / baseIds.length : null,
  };

  // 4. Baseline, headline, comparison.
  const baseline = popularityBaseline(perks, budget);
  const headline = buildHeadline(perks, byScenario.base, baseline, cfg, budget, cands.length);
  const popRound = new Map<string, string[]>();
  for (const p of perks) {
    if (p.popularity === null) continue;
    const key = (Math.round(p.popularity * 100) / 100).toFixed(2);
    popRound.set(key, [...(popRound.get(key) ?? []), p.candidateId]);
  }
  const ties = sortIds([...popRound.values()].filter((g) => g.length > 1).flat());
  if (ties.length) warnings.push({ code: 'popularity_ties', ids: ties });
  const withPop = perks.filter((p) => p.popularityPercentile !== null);
  const vsPopularity = {
    diff: diffBundles(baseIds, baseline.perkIds),
    rho: spearman(withPop.map((p) => p.percentile), withPop.map((p) => p.popularityPercentile as number)),
    rhoN: withPop.length,
  };

  const sensitivityResult = sensitivity(sens, baseIds, cfg, members, budget);
  const holdout = buildHoldout(perks, baseIds, input.segment.label, members, cfg);
  const ledger = buildLedger(
    { input, cfg, perks, deferred, bundle, headline, vsPopularity, popularityIds: baseline.perkIds, sensitivity: sensitivityResult },
    opts.seqOffset ?? 0,
  );

  return {
    segmentId: input.segment.id,
    budget,
    members,
    config: cfg,
    perks,
    deferred,
    bundle,
    baseline,
    headline,
    compare: { vsPopularity },
    sensitivity: sensitivityResult,
    holdout,
    ledger,
    warnings,
  };
}
