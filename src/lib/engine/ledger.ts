import { DOMAINS } from '@/lib/types';
import type { Domain, LedgerEntry, RunInput, Scenario } from '@/lib/types';
import { SCENARIOS } from '@/lib/types';
import type { BundleSet, CompareResult, DeferredPerk, EngineConfig, PerkScore, SensitivityResult } from './types';
import type { Headline } from '@/lib/types';
import { cents, cmpStr as cmpStrIds, r4 } from './util';

interface Ctx {
  input: RunInput;
  cfg: EngineConfig;
  perks: PerkScore[];
  deferred: DeferredPerk[];
  bundle: BundleSet;
  headline: Headline;
  vsPopularity: CompareResult;
  popularityIds: string[];
  sensitivity: SensitivityResult;
}

type Draft = Omit<LedgerEntry, 'seq'>;

const A = (field: string, subject: string, variant?: string): string => ['assume', field, subject, variant].filter(Boolean).join('.');
const C = (field: string, subject: string, variant?: string): string => ['calc', field, subject, variant].filter(Boolean).join('.');

/**
 * Build the engine's ledger entries. Only the base scenario is itemized per perk; the optimistic and
 * pessimistic scenarios appear only in the global entries. `seqOffset` lets the caller append after Qloo entries.
 */
export function buildLedger(ctx: Ctx, seqOffset = 0): LedgerEntry[] {
  const { input, cfg, perks, deferred, bundle, headline } = ctx;
  const out: Draft[] = [];
  const baseIds = new Set(bundle.byScenario.base.perkIds);
  const popIds = new Set(ctx.popularityIds);
  const weightOf = (d: Domain): number => input.domainWeights?.[d] ?? 1;

  // --- assumptions ---
  const asm = (field: string, subject: string, value: number | string, extra: Partial<Draft> = {}, variant?: string) =>
    out.push({ id: A(field, subject, variant), source: 'assumption', field, value, ...extra });
  asm('budget', 'run', input.budget, { unit: 'usd' });
  asm('members', 'run', input.members, { unit: 'count' });
  for (const t of ['high', 'mid', 'low'] as const) asm(`usage_rate_${t}`, 'run', cfg.tierUsage[t], { unit: 'ratio', note: 'assumed share of members using the perk' });
  for (const s of SCENARIOS) asm('scenario_multiplier', 'run', cfg.scenarioMult[s], { unit: 'ratio', scenario: s }, s);
  asm('cut_low', 'run', r4(cfg.cuts.low), { unit: 'ratio' });
  asm('cut_high', 'run', r4(cfg.cuts.high), { unit: 'ratio' });
  asm('quant_unit', 'run', cfg.quantUnit, { unit: 'usd' });
  asm('holdout_share', 'run', cfg.holdout.share, { unit: 'ratio' });
  asm('holdout_weeks', 'run', cfg.holdout.weeks, { unit: 'count' });
  asm('small_saving_ratio', 'run', cfg.smallSavingRatio, { unit: 'ratio' });
  asm('sensitivity_delta', 'run', cfg.sensitivityDelta, { unit: 'ratio' });
  const cands = [...input.candidates].sort((a, b) => cmpStrIds(a.id, b.id));
  for (const d of DOMAINS) {
    if (cands.some((c) => c.domain === d)) asm('domain_weight', d, weightOf(d), { domain: d });
  }
  for (const c of cands) {
    asm('unit_cost', c.id, c.unitCost, { unit: 'usd', candidateId: c.id, domain: c.domain });
    asm('billing', c.id, c.billing, { candidateId: c.id, domain: c.domain });
    asm('friction', c.id, c.friction, { candidateId: c.id, domain: c.domain });
  }

  // --- per-perk calc (base scenario only) ---
  const budgetId = A('budget', 'run');
  const membersId = A('members', 'run');
  const byDomain = new Map<Domain, PerkScore[]>();
  for (const p of perks) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p]);
  const calc = (id: string, field: string, value: number | string, dependsOn: string[], extra: Partial<Draft> = {}) =>
    out.push({ id, source: 'calc', field, value, dependsOn, ...extra });

  for (const p of perks) {
    const cid = p.candidateId;
    const peers = byDomain.get(p.domain) as PerkScore[];
    const common = { candidateId: cid, domain: p.domain };
    calc(C('percentile', cid), 'percentile', r4(p.percentile), peers.map((q) => `qloo.affinity.${q.candidateId}`), {
      ...common, unit: 'ratio', note: `rank ${p.rank} of ${p.domainN} in ${p.domain}`,
    });
    calc(C('fit_tier', cid), 'fit_tier', p.tier, [C('percentile', cid), A('cut_low', 'run'), A('cut_high', 'run')], { ...common, unit: 'tier' });
    if (p.popularityPercentile !== null) {
      const popPeers = peers.filter((q) => q.popularityPercentile !== null);
      calc(C('popularity_percentile', cid), 'popularity_percentile', r4(p.popularityPercentile), popPeers.map((q) => `qloo.popularity.${q.candidateId}`), {
        ...common, unit: 'ratio', note: `popularity percentile within ${p.domain}`,
      });
    }
    const b = p.scn.base;
    const usageId = C('usage_rate', cid);
    calc(usageId, 'usage_rate', r4(b.usageRate), [C('fit_tier', cid), A(`usage_rate_${p.tier}`, 'run'), A('friction', cid), A('scenario_multiplier', 'run', 'base')], {
      ...common, scenario: 'base', unit: 'ratio', note: 'assumed share of members using the perk',
    });
    calc(C('monthly_cost', cid), 'monthly_cost', cents(b.monthlyCost),
      p.billing === 'fixed' ? [A('unit_cost', cid), A('billing', cid), membersId] : [usageId, A('unit_cost', cid), A('billing', cid), membersId],
      { ...common, scenario: 'base', unit: 'usd' });
    calc(C('fit_value', cid), 'fit_value', r4(b.value), [A('domain_weight', p.domain), C('percentile', cid), membersId, usageId], { ...common, scenario: 'base' });
    calc(C('in_bundle', cid), 'in_bundle', baseIds.has(cid) ? 1 : 0, [C('monthly_cost', cid), C('fit_value', cid), budgetId, A('quant_unit', 'run')], {
      ...common, scenario: 'base', unit: 'count', note: 'chosen by a 0/1 bundle search over all scored perks',
    });
    calc(C('stability', cid), 'stability', bundle.inScenarioCount[cid] ?? 0,
      SCENARIOS.map((s) => C('bundle_cost', 'run', s)), { ...common, unit: 'count', note: 'number of the 3 scenario bundles containing this perk' });
    calc(C('in_popularity_bundle', cid), 'in_popularity_bundle', popIds.has(cid) ? 1 : 0,
      [C('monthly_cost', cid), budgetId, ...(p.popularity !== null ? [`qloo.popularity.${cid}`] : [])], { ...common, scenario: 'base', unit: 'count' });
    if (p.tier === 'low') {
      calc(C('skipped', cid), 'skipped', baseIds.has(cid) ? 0 : 1, [C('fit_tier', cid), C('in_bundle', cid)], { ...common, unit: 'count', note: 'low taste fit and not in the optimized bundle' });
    }
  }

  // --- global calc ---
  const allInBundle = perks.map((p) => C('in_bundle', p.candidateId));
  const allCost = perks.map((p) => C('monthly_cost', p.candidateId));
  const allValue = perks.map((p) => C('fit_value', p.candidateId));
  for (const s of SCENARIOS as readonly Scenario[]) {
    const bd = bundle.byScenario[s];
    const members = new Set(bd.perkIds);
    const scnDeps = s === 'base'
      ? [...allInBundle, ...perks.filter((p) => members.has(p.candidateId)).map((p) => C('monthly_cost', p.candidateId))]
      : [...allCost, ...allValue, A('scenario_multiplier', 'run', s), budgetId, A('quant_unit', 'run')];
    const deps = scnDeps.length ? scnDeps : [budgetId];
    calc(C('bundle_cost', 'run', s), 'bundle_cost', cents(bd.totalCost), deps, { scenario: s, unit: 'usd' });
    calc(C('bundle_size', 'run', s), 'bundle_size', bd.perkIds.length, deps, { scenario: s, unit: 'count' });
  }
  const lowPerks = perks.filter((p) => p.tier === 'low');
  calc(C('headline_n', 'run'), 'headline_n', headline.n,
    lowPerks.length ? lowPerks.map((p) => C('skipped', p.candidateId)) : [A('cut_low', 'run'), A('cut_high', 'run')], { unit: 'count' });
  calc(C('headline_low_total', 'run'), 'headline_low_total', headline.lowFitTotal,
    perks.length ? perks.map((p) => C('fit_tier', p.candidateId)) : [A('cut_low', 'run')], { unit: 'count' });
  const popLow = lowPerks.filter((p) => popIds.has(p.candidateId));
  const skippedCostDeps = (extra: string[] = []) => {
    const d = [...popLow.flatMap((p) => [C('monthly_cost', p.candidateId), C('in_popularity_bundle', p.candidateId)]), ...extra];
    return d.length ? d : [C('headline_n', 'run')];
  };
  calc(C('headline_save', 'run', 'base'), 'headline_save', cents(headline.saveBase), skippedCostDeps(), { scenario: 'base', unit: 'usd' });
  calc(C('headline_save', 'run', 'pessimistic'), 'headline_save', cents(headline.saveLow), skippedCostDeps([A('scenario_multiplier', 'run', 'pessimistic')]), { scenario: 'pessimistic', unit: 'usd' });
  calc(C('headline_save', 'run', 'optimistic'), 'headline_save', cents(headline.saveHigh), skippedCostDeps([A('scenario_multiplier', 'run', 'optimistic')]), { scenario: 'optimistic', unit: 'usd' });
  calc(C('headline_save_fixed', 'run'), 'headline_save_fixed', cents(headline.saveFixedPart),
    skippedCostDeps(), { scenario: 'base', unit: 'usd', note: 'part of the headline amount from fixed-fee perks' });
  const cv = ctx.vsPopularity;
  calc(C('changed_vs_popularity', 'run'), 'changed_vs_popularity', `${cv.diff.n} of ${cv.diff.m}`,
    perks.length ? [...allInBundle, ...perks.map((p) => C('in_popularity_bundle', p.candidateId))] : [budgetId], { unit: 'count' });
  if (cv.rho !== null) {
    const withPop = perks.filter((p) => p.popularityPercentile !== null);
    calc(C('spearman_vs_popularity', 'run'), 'spearman_vs_popularity', r4(cv.rho),
      [...withPop.map((p) => C('percentile', p.candidateId)), ...withPop.map((p) => C('popularity_percentile', p.candidateId))], { unit: 'ratio', note: `n=${cv.rhoN}` });
  }
  if (ctx.sensitivity.retained !== null) {
    calc(C('sensitivity_retained', 'run'), 'sensitivity_retained', r4(ctx.sensitivity.retained),
      [C('bundle_size', 'run', 'base'), A('cut_low', 'run'), A('cut_high', 'run'), A('sensitivity_delta', 'run')], { unit: 'ratio' });
  }
  if (bundle.stability !== null) {
    calc(C('stability_ratio', 'run'), 'stability_ratio', r4(bundle.stability), SCENARIOS.map((s) => C('bundle_size', 'run', s)), { unit: 'ratio' });
  }
  calc(C('deferred_count', 'run'), 'deferred_count', deferred.length,
    cands.length ? cands.map((c) => `qloo.affinity.${c.id}`) : [budgetId], { unit: 'count', note: 'candidates without a usable Qloo score' });

  return out.map((e, i) => ({ ...e, seq: seqOffset + i + 1 }));
}
