/**
 * The one file that knows the engine's field names. It turns engine output plus server data into plain,
 * display-ready values; components only format nothing and compute nothing.
 */
import { CANDIDATES } from '@/data/candidates';
import type { CandidateOverride, ExplanationItem } from '@/lib/api/types';
import type { Candidate, CandidateScore, DataSource, Domain, FitTier, Headline, InterestChip, NoDataReason, RunInput, RunMeta, Scenario } from '@/lib/types';
import { SCENARIOS } from '@/lib/types';
import type { CompareResult, EngineConfig, PerkScore, RunResult, SegmentCompare } from './engine';
import { compareBundles, compareSegments, runEngine } from './engine';
import { percent, plural, usd } from './format';

export type BadgeKind = 'qloo' | 'assumption' | 'calc' | 'sample';

/** Which badge a ledger row wears. Qloo-sourced rows read as SAMPLE whenever the run used synthetic data. */
export function badgeFor(source: 'qloo' | 'assumption' | 'calc' | 'sample', dataSource: DataSource): BadgeKind {
  if (source === 'assumption') return 'assumption';
  if (source === 'calc') return 'calc';
  return dataSource === 'sample' || source === 'sample' ? 'sample' : 'qloo';
}

const BASE = new Map(CANDIDATES.map((c) => [c.id, c]));

export const DOMAIN_LABEL: Record<Domain, string> = { place: 'Place', tv_show: 'TV show', brand: 'Brand', book: 'Book' };
export const TIER_LABEL: Record<FitTier, string> = { high: 'High', mid: 'Mid', low: 'Low' };
export const DOMAIN_PLURAL: Record<Domain, string> = { place: 'places', tv_show: 'TV shows', brand: 'brands', book: 'books' };
export const TIER_DOTS: Record<FitTier, string> = { high: '●●●', mid: '●●○', low: '●○○' };
const SCENARIO_LABEL: Record<Scenario, string> = { pessimistic: 'Pessimistic', base: 'Base', optimistic: 'Optimistic' };
const NO_DATA_TEXT: Record<NoDataReason, string> = {
  no_match: 'no match',
  not_returned: 'not returned',
  no_affinity: 'no affinity',
  domain_error: 'domain failed',
};

export interface WhyRowVm { key: string; badge: BadgeKind; field: string; value: string; note?: string }
export interface SentenceVm { state: 'verified' | 'discarded' | 'pending' | 'hidden'; text: string | null }
export interface BundleRowVm {
  id: string; name: string; domain: string; tier: FitTier; tierDots: string; tierLabel: string;
  percentile: string; cost: string; costRange: string; stable: string;
  /** "#2 of 5 by popularity", or null when this perk has no popularity signal. */
  popularityRank: string | null;
  /** Why a non-high perk is in the bundle; null for high-tier perks. */
  reason: string | null;
  why: WhyRowVm[]; sentence: SentenceVm;
}
export interface CardVm { title: string; headline: string; lines: string[]; added: string[]; dropped: string[]; note?: string }
export interface CandidateRowVm {
  id: string; name: string; domain: Domain; domainLabel: string; unitCost: number; billing: Candidate['billing']; friction: number;
  match: { kind: 'none' } | { kind: 'tier'; tier: FitTier; text: string } | { kind: 'no_data'; text: string };
  /** True for the fields whose value differs from the catalog default. */
  edited: { unitCost: boolean; billing: boolean; friction: boolean };
}

export interface ViewModel {
  result: RunResult;
  /** Three plain sentences for a manager, plus a paste-ready copy. null when nothing can be judged. */
  summary: { lines: [string, string, string]; copyText: string } | null;
  headline: {
    kind: Headline['kind']; text: string; subtitle: string; skippedLine: string | null; definition: string; hint: string | null;
  };
  spend: { used: number; budget: number; ratio: number; parts: { id: string; name: string; cost: number }[] };
  scenarios: { scenario: Scenario; label: string; perks: number; spend: string; saved: string | null }[];
  /** How many perks stay in the base bundle when the tier cuts move; null when not computable. */
  sensitivity: string | null;
  bundle: BundleRowVm[];
  skipped: string[];
  onHold: { id: string; name: string; why: string }[];
  holdoutIntro: string;
  holdout: { id: string; name: string; question: string; share: string; duration: string; metric: string; rule: string }[];
  cards: { popularity: CardVm; llm: CardVm | null; llmState: 'ok' | 'failed' | 'none'; swap: CardVm | null };
}

export interface ViewModelArgs {
  input: RunInput;
  cfg: EngineConfig;
  scores: CandidateScore[];
  dataSource: DataSource;
  /** Inputs and scores as they were when the run finished: the LLM card is pinned to these. */
  snapshot: { input: RunInput; cfg: EngineConfig; scores: CandidateScore[] };
  llm?: { status: 'ok' | 'failed'; picks: string[]; dropped: string[] } | null;
  /** True while the run is still streaming: AI sentences not yet in are "checking", afterwards they are "none verified". */
  explanationsPending: boolean;
  explanations?: ExplanationItem[] | null;
  /** True when the current inputs differ from the ones the AI sentences were checked against. */
  stale: boolean;
  other?: { input: RunInput; scores: CandidateScore[] } | null;
}

/** Tail of the popularity card headline. rho < 0.3 barely agree, >= 0.7 mostly agree. */
function agreement(rho: number | null): string {
  if (rho !== null && rho < 0.3) return 'the two rankings barely agree.';
  if (rho !== null && rho >= 0.7) return 'the rankings mostly agree.';
  return 'the rankings partly agree.';
}

const rhoText = (r: number | null): string => (r === null ? 'n/a' : r.toFixed(2));

function names(ids: string[], byId: Map<string, string>): string[] {
  return ids.slice(0, 4).map((id) => byId.get(id) ?? id).concat(ids.length > 4 ? [`+${ids.length - 4} more`] : []);
}

/** "#k of n by popularity" within the perk's own category; null when the perk or its category lacks popularity data. */
function popularityRankOf(p: PerkScore, perks: readonly PerkScore[]): string | null {
  if (p.popularity === null) return null;
  const peers = perks.filter((x) => x.domain === p.domain && x.popularity !== null);
  const rank = peers.filter((x) => (x.popularity as number) > (p.popularity as number)).length + 1;
  return `#${rank} of ${peers.length} by popularity`;
}

function whyRows(p: PerkScore, c: Candidate, score: CandidateScore | undefined, chips: InterestChip[], dataSource: DataSource): WhyRowVm[] {
  const q = badgeFor('qloo', dataSource);
  const chipName = new Map(chips.map((x) => [x.token, x.name]));
  const rows: WhyRowVm[] = [{ key: 'affinity', badge: q, field: 'Qloo affinity for this segment', value: p.affinity.toFixed(2) }];
  if (score?.popularity !== null && score?.popularity !== undefined) {
    rows.push({ key: 'popularity', badge: q, field: 'Popularity', value: score.popularity.toFixed(2) });
  }
  for (const e of score?.explain ?? []) {
    rows.push({ key: `chip-${e.token}`, badge: q, field: `${chipName.get(e.token) ?? 'chip'} adds`, value: e.score.toFixed(2) });
  }
  rows.push(
    { key: 'percentile', badge: 'calc', field: `Rank among ${DOMAIN_PLURAL[p.domain]}`, value: `${p.rank} of ${p.domainN} (${percent(p.percentile)})` },
    { key: 'tier', badge: 'calc', field: 'Taste match', value: TIER_LABEL[p.tier] },
    { key: 'usage', badge: 'assumption', field: 'Assumed to use it', value: `${percent(p.scn.base.usageRate)} of members`, note: `${TIER_LABEL[p.tier]} match rate × effort ${c.friction}` },
    { key: 'unit', badge: 'assumption', field: c.billing === 'fixed' ? 'Fixed fee per member (assumed)' : 'Cost per use (assumed)', value: usd(c.unitCost) },
    { key: 'cost', badge: 'calc', field: 'Est. cost / month', value: usd(p.scn.base.monthlyCost) },
  );
  return rows;
}

export function candidateRows(
  input: RunInput,
  scores: CandidateScore[] | null,
  result: RunResult | null,
  overrides?: Record<string, Partial<CandidateOverride>>,
): CandidateRowVm[] {
  const sc = new Map((scores ?? []).map((s) => [s.candidateId, s]));
  const pk = new Map((result?.perks ?? []).map((p) => [p.candidateId, p]));
  return input.candidates.map((c): CandidateRowVm => {
    const s = sc.get(c.id);
    const p = pk.get(c.id);
    let match: CandidateRowVm['match'] = { kind: 'none' };
    if (p) match = { kind: 'tier', tier: p.tier, text: `${TIER_LABEL[p.tier]} (${percent(p.percentile)})` };
    else if (s) match = { kind: 'no_data', text: `no data${s.reason ? ` (${NO_DATA_TEXT[s.reason]})` : ''}` };
    const o = overrides?.[c.id];
    const edited = {
      unitCost: o?.unitCost !== undefined && o.unitCost !== BASE.get(c.id)?.unitCost,
      billing: o?.billing !== undefined && o.billing !== BASE.get(c.id)?.billing,
      friction: o?.friction !== undefined && o.friction !== BASE.get(c.id)?.friction,
    };
    return { id: c.id, name: c.name, domain: c.domain, domainLabel: DOMAIN_LABEL[c.domain], unitCost: c.unitCost, billing: c.billing, friction: c.friction, match, edited };
  });
}

export function toViewModel(a: ViewModelArgs): ViewModel {
  const result = runEngine(a.input, a.scores, a.cfg);
  const nameOf = new Map(a.input.candidates.map((c) => [c.id, c.name]));
  const candOf = new Map(a.input.candidates.map((c) => [c.id, c]));
  const perkOf = new Map(result.perks.map((p) => [p.candidateId, p]));
  const scoreOf = new Map(a.scores.map((s) => [s.candidateId, s]));
  const h = result.headline;
  const baseBundle = result.bundle.byScenario.base;

  const hasSave = h.kind === 'skip' || h.kind === 'skip_small';
  const headline: ViewModel['headline'] = {
    kind: h.kind,
    text: h.text,
    subtitle: h.subtitle,
    skippedLine: h.n > 0 ? `Skipped ${h.n} low-fit ${plural(h.n, 'perk')}: ${h.skippedIds.map((id) => nameOf.get(id) ?? id).join(', ')}` : null,
    definition: "Taste match comes from Qloo's ranking for this segment. The bundle is the best value inside the budget.",
    hint:
      h.kind === 'insufficient' && h.bundleCount === 0 && result.perks.length > 0
        ? 'Raise the budget or lower a unit cost, then run again.'
        : h.kind === 'insufficient' || h.kind === 'same'
          ? 'Try adding an interest chip or choosing a different example segment.'
          : null,
  };

  const sentenceFor = (id: string): SentenceVm => {
    if (a.stale) return { state: 'hidden', text: null };
    const item = a.explanations?.find((e) => e.candidateId === id);
    if (!item) return { state: a.explanationsPending ? 'pending' : 'discarded', text: null };
    return item.status === 'verified' && item.sentence ? { state: 'verified', text: item.sentence } : { state: 'discarded', text: null };
  };

  const bundle: BundleRowVm[] = baseBundle.perkIds.map((id) => {
    const p = perkOf.get(id)!;
    const c = candOf.get(id)!;
    const costs = SCENARIOS.map((sc) => p.scn[sc].monthlyCost);
    return {
      id, name: p.name, domain: DOMAIN_LABEL[p.domain], tier: p.tier, tierDots: TIER_DOTS[p.tier], tierLabel: TIER_LABEL[p.tier],
      percentile: percent(p.percentile), cost: usd(p.scn.base.monthlyCost), costRange: `${usd(Math.min(...costs))} to ${usd(Math.max(...costs))}`,
      stable: `in ${result.bundle.inScenarioCount[id]} of 3 usage cases`,
      popularityRank: popularityRankOf(p, result.perks),
      reason: p.tier === 'high' ? null : 'Included: best value left for the budget',
      why: whyRows(p, c, scoreOf.get(id), a.input.segment.interests, a.dataSource),
      sentence: sentenceFor(id),
    };
  });

  const scenarios = SCENARIOS.slice().reverse().map((scn) => {
    const b = result.bundle.byScenario[scn];
    const saved = scn === 'base' ? h.saveBase : scn === 'pessimistic' ? h.saveLow : h.saveHigh;
    return { scenario: scn, label: SCENARIO_LABEL[scn], perks: b.perkIds.length, spend: usd(b.totalCost), saved: hasSave ? usd(saved) : null };
  });

  // Card 1: same assumptions, popularity order.
  const vp: CompareResult = result.compare.vsPopularity;
  const popularity: CardVm = {
    title: 'If you chose by popularity',
    headline: `${vp.diff.n} of ${vp.diff.m} ${plural(vp.diff.m, 'perk')} change; ${agreement(vp.rho)}`,
    lines: [`Rank agreement ${rhoText(vp.rho)}`],
    added: names(vp.diff.added, nameOf),
    dropped: names(vp.diff.dropped, nameOf),
    note: 'Many perks score almost the same, so small changes can reorder them.',
  };

  // Card 2: LLM alone, pinned to the inputs of the run (no rho: the model returns a set, not scores).
  let llm: CardVm | null = null;
  let llmState: ViewModel['cards']['llmState'] = 'none';
  if (a.llm) {
    if (a.llm.status === 'failed') {
      llmState = 'failed';
    } else {
      llmState = 'ok';
      const snap = runEngine(a.snapshot.input, a.snapshot.scores, a.snapshot.cfg);
      const cmp = compareBundles(snap, a.llm.picks);
      llm = {
        title: 'A general AI with no Qloo data',
        headline: `Picks ${cmp.diff.m - cmp.diff.n} of the same ${cmp.diff.m} ${plural(cmp.diff.m, 'perk')}, but shows no per-perk evidence.`,
        lines: a.llm.dropped.length > 0 ? [`Over budget, trimmed by code: ${a.llm.dropped.length}`] : [],
        added: names(cmp.diff.added, nameOf),
        dropped: names(cmp.diff.dropped, nameOf),
        note: `Computed for budget ${usd(a.snapshot.input.budget)} and costs as of the run.`,
      };
    }
  }

  // Card 3: swap segment.
  let swap: CardVm | null = null;
  if (a.other) {
    const otherRun = runEngine(a.other.input, a.other.scores, a.cfg);
    const sc: SegmentCompare = compareSegments(result, otherRun);
    swap = {
      title: `Different segment: ${a.input.segment.label} → ${a.other.input.segment.label}`,
      headline: `${sc.diff.n} of ${sc.diff.m} ${plural(sc.diff.m, 'perk')} change when the segment changes.`,
      lines: [`Rank agreement ${rhoText(sc.rho)}`],
      added: names(sc.diff.added, nameOf),
      dropped: names(sc.diff.dropped, nameOf),
    };
  }

  const bundleSize = baseBundle.perkIds.length;
  let summary: ViewModel['summary'] = null;
  if (h.kind !== 'insufficient') {
    const top = baseBundle.perkIds.map((id) => perkOf.get(id)!).sort((x, y) => y.percentile - x.percentile || x.name.localeCompare(y.name))[0];
    const line3 = h.n === 0
      ? h.lowFitTotal === 0
        ? 'No low-fit perks among the scored candidates.'
        : `All ${h.lowFitTotal} low-fit ${plural(h.lowFitTotal, 'perk')} still fit inside the best bundle.`
      : h.kind === 'all_in'
        ? `Popularity order would also skip the ${h.n} low-fit ${plural(h.n, 'perk')}.`
        : `Skipping ${h.n} low-fit ${plural(h.n, 'perk')} keeps about ${usd(h.saveBase)} from going to perks this segment rates low.`;
    const lines: [string, string, string] = [
      `For ${a.input.segment.label}, the best ${bundleSize}-perk bundle costs about ${usd(h.bundleCost)} of your ${usd(a.input.budget)}/month.`,
      `Top pick: ${top.name}, the highest taste match among ${DOMAIN_PLURAL[top.domain]} (${percent(top.percentile)} rank in category).`,
      line3,
    ];
    summary = { lines, copyText: [...lines, 'Source: PerkFit, Qloo taste data for the segment; costs and usage are assumptions.'].join('\n') };
  }

  const retained = result.sensitivity.retained;
  const sensitivity = retained === null || bundleSize === 0
    ? null
    : `Keeps ${Math.round(retained * bundleSize)} of ${bundleSize} perks when the tier cuts move by ${Math.round(a.cfg.sensitivityDelta * 100)} points either way.`;

  const reasonOf = (r: 'no_data' | 'no_match', id: string) => {
    const s = scoreOf.get(id);
    return s?.reason ? NO_DATA_TEXT[s.reason] : r === 'no_match' ? 'no match' : 'no data';
  };

  return {
    result,
    summary,
    headline,
    spend: { used: baseBundle.totalCost, budget: a.input.budget, ratio: baseBundle.budgetUsedRatio,
      parts: baseBundle.perkIds.map((id) => ({ id, name: nameOf.get(id) ?? id, cost: perkOf.get(id)!.scn.base.monthlyCost })) },
    scenarios,
    sensitivity,
    bundle,
    skipped: h.skippedIds.map((id) => nameOf.get(id) ?? id),
    onHold: result.deferred.map((d) => ({ id: d.candidateId, name: d.name, why: reasonOf(d.reason, d.candidateId) })),
    holdoutIntro: `Our taste match is a hypothesis. Check it by hiding each perk from ${percent(a.cfg.holdout.share)} of members for ${a.cfg.holdout.weeks} weeks.`,
    holdout: result.holdout.map((r) => ({
      id: r.candidateId, name: nameOf.get(r.candidateId) ?? r.candidateId, question: r.hypothesis,
      share: percent(r.holdoutShare), duration: `${r.weeks} weeks`, metric: r.metric, rule: r.successRule,
    })),
    cards: { popularity, llm, llmState, swap },
  };
}

/** Header meta line. Everything comes from the server's RunMeta. */
export function metaLine(meta: RunMeta): string {
  const date = meta.fetchedAt ? meta.fetchedAt.slice(0, 10) : null;
  const source = meta.dataSource === 'cache' ? ` (cached from live${date ? ` on ${date}` : ''})` : meta.dataSource === 'sample' ? ' (sample mode)' : ' (live)';
  const e = meta.explanations;
  return `${meta.qlooCalls} Qloo ${plural(meta.qlooCalls, 'call')}${source} · agent: ${meta.agentSteps} ${plural(meta.agentSteps, 'step')} · explanations ${e.passed}/${e.total} verified`;
}
