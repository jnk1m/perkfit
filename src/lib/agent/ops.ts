import type { DomainStatus } from '@/lib/api/types';
import { EngineInputError, neutralCost, runEngine } from '@/lib/engine';
import { Ledger, buildCandidateFacts, qlooEntriesFromDomainResults } from '@/lib/ledger';
import type { CandidateFacts } from '@/lib/ledger';
import { applyTemplates, runExplain } from '@/lib/llm/explain';
import type { ExplainOutcome } from '@/lib/llm/explain';
import { runLlmAlone } from '@/lib/llm/llm-alone';
import { emptyStats } from '@/lib/llm/validator';
import type { DomainScoreResult } from '@/lib/qloo/types';
import type { CandidateScore, Domain } from '@/lib/types';
import { DOMAINS } from '@/lib/types';
import type { ChipResolution } from './ports';
import { RunFailure, type RunSession } from './session';

/**
 * Plain operations behind the nine tools. The model-driven loop and the deterministic orchestrator
 * both call these, so a fallback run produces the same artifacts as a loop run.
 */
export interface OpOut {
  ok: boolean;
  summary: string;
  data: Record<string, unknown>;
}

const fail = (summary: string, data: Record<string, unknown> = {}): OpOut => ({ ok: false, summary, data: { error: summary, ...data } });

function describeDomain(s: RunSession, r: DomainScoreResult): Record<string, unknown> {
  const nameOf = new Map(s.candidates.map((c) => [c.id, c.name]));
  const noData = r.scores
    .filter((x) => x.status !== 'ok')
    .map((x) => ({ candidateId: x.candidateId, name: nameOf.get(x.candidateId), status: x.status, reason: x.reason }));
  return { domain: r.domain, qloo: r.envelope.code, scored: r.scores.filter((x) => x.status === 'ok').length, noData };
}

function failedDomain(s: RunSession, domain: Domain, detail: string): DomainScoreResult {
  return {
    domain,
    envelope: { code: 'upstream', retryable: false, latencyMs: 0, source: 'network', detail },
    scores: s.candidates
      .filter((c) => c.domain === domain)
      .map((c): CandidateScore => ({ candidateId: c.id, status: 'no_data', reason: 'domain_error', affinity: null, popularity: null, explain: [] })),
    callSummary: { call: 'GET /v2/insights', params: { 'filter.type': domain } },
  };
}

// ---------------------------------------------------------------------------------------------
// resolve_chip / ask_user

export async function resolveChipOp(s: RunSession, token: string): Promise<OpOut> {
  const t0 = s.now();
  const chip = s.req.segment.interests.find((c) => c.token === token);
  if (!chip) {
    const out = fail(`unknown chip token`, { token });
    s.record('resolve_chip', false, t0, 0, 'unknown chip token');
    return out;
  }
  const before = s.qctx.stats.networkCalls;
  s.stage('resolve', 'start');
  let res: ChipResolution;
  try {
    res = await s.deps.qloo.resolveChip(chip, s.req.answers?.[`chip:${token}`], s.qctx);
  } catch (err) {
    res = { status: 'unavailable', detail: err instanceof Error ? err.name : 'error' };
  }
  s.chips.set(token, res);
  if (res.status === 'resolved' && res.token !== token) {
    s.segment = { ...s.segment, interests: s.segment.interests.map((c) => (c.token === token ? { ...c, token: res.token } : c)) };
  }
  s.stage('resolve', res.status === 'resolved' ? 'done' : 'error', s.now() - t0);
  const calls = s.qctx.stats.networkCalls - before;
  s.record('resolve_chip', res.status === 'resolved', t0, calls, `chip ${chip.name}: ${res.status}`);
  return {
    ok: res.status === 'resolved',
    summary: res.status,
    data: {
      token,
      name: chip.name,
      status: res.status,
      ...(res.status === 'ambiguous' ? { options: res.options } : {}),
      ...(res.status === 'resolved' ? {} : { next: res.status === 'ambiguous' ? 'call ask_user for this chip' : 'chip cannot be used' }),
    },
  };
}

export function askUserOp(s: RunSession, token: string): OpOut {
  const t0 = s.now();
  const chip = s.req.segment.interests.find((c) => c.token === token);
  const res = s.chips.get(token);
  if (!chip || !res || res.status !== 'ambiguous') {
    s.record('ask_user', false, t0, 0, 'no ambiguous chip for this token');
    return fail('this chip is not ambiguous; ask_user is only for chips resolve_chip reported as ambiguous');
  }
  s.emit({
    type: 'ask_user',
    questionId: `chip:${token}`,
    question: `Which "${chip.name.slice(0, 80)}" did you mean?`,
    options: res.options,
  });
  s.asked = true;
  s.record('ask_user', true, t0, 0, `asked which "${chip.name}"`);
  return { ok: true, summary: 'asked', data: { asked: true, note: 'stop now; the run resumes after the user answers' } };
}

// ---------------------------------------------------------------------------------------------
// score_domain / resolve_candidate / read_popularity

export async function scoreDomainOp(s: RunSession, domain: Domain): Promise<OpOut> {
  const t0 = s.now();
  const stage = `score_${domain}` as const;
  const existing = s.domainResults.get(domain);
  if (existing) {
    s.record('score_domain', true, t0, 0, `${domain}: already scored`);
    return { ok: true, summary: 'already scored', data: describeDomain(s, existing) };
  }
  if (!s.chipsResolved()) {
    s.record('score_domain', false, t0, 0, `${domain}: chips not resolved`);
    return fail('resolve every interest chip first (resolve_chip)');
  }
  s.stage(stage, 'start');
  let r: DomainScoreResult;
  try {
    r = await s.deps.qloo.scoreDomain(domain, s.segment, s.candidates, s.qctx);
  } catch (err) {
    r = failedDomain(s, domain, err instanceof Error ? err.name : 'error');
  }
  s.domainResults.set(domain, r);
  const good = r.envelope.code === 'ok' || r.envelope.code === 'empty';
  s.stage(stage, good ? 'done' : 'error', s.now() - t0);
  const ok = r.scores.filter((x) => x.status === 'ok').length;
  s.record('score_domain', good, t0, r.envelope.source === 'network' ? 1 : 0, `${domain}: ${ok}/${r.scores.length} scored (${r.envelope.code}, ${r.envelope.source})`);
  return { ok: good, summary: r.envelope.code, data: describeDomain(s, r) };
}

export async function resolveCandidateOp(s: RunSession, candidateId: string, query?: string): Promise<OpOut> {
  const t0 = s.now();
  const cand = s.candidates.find((c) => c.id === candidateId);
  const result = cand ? s.domainResults.get(cand.domain) : undefined;
  const current = result?.scores.find((x) => x.candidateId === candidateId);
  if (!cand || !result || !current) {
    s.record('resolve_candidate', false, t0, 0, `${candidateId}: not scored yet`);
    return fail('score the candidate\'s domain first (score_domain)');
  }
  if (s.run) {
    s.record('resolve_candidate', false, t0, 0, `${cand.id}: bundle already computed`);
    return fail('the bundle is already computed; retries are only possible before optimize_bundle');
  }
  if (current.status === 'ok') {
    s.record('resolve_candidate', false, t0, 0, `${cand.id}: already scored`);
    return fail('this candidate already has a score');
  }
  if (s.resolveRetries >= s.limits.resolveRetries) {
    s.record('resolve_candidate', false, t0, 0, `${cand.id}: retry limit`);
    return fail(`retry limit reached (${s.limits.resolveRetries} per run)`);
  }
  s.resolveRetries += 1;
  const before = s.qctx.stats.networkCalls;
  let outcome;
  try {
    outcome = await s.deps.qloo.resolveCandidate({ id: cand.id, name: query ?? cand.name, domain: cand.domain }, s.qctx);
  } catch (err) {
    outcome = { status: 'unavailable', matchedName: undefined } as const;
    void err;
  }
  let status: CandidateScore['status'] = current.status;
  if (outcome.status === 'resolved') {
    s.domainResults.delete(cand.domain);
    await scoreDomainOp(s, cand.domain);
    status = s.domainResults.get(cand.domain)?.scores.find((x) => x.candidateId === cand.id)?.status ?? status;
  }
  const calls = s.qctx.stats.networkCalls - before;
  s.record('resolve_candidate', outcome.status === 'resolved', t0, calls, `${cand.id}${query ? ` as "${query}"` : ''}: ${outcome.status}, now ${status}`);
  return {
    ok: outcome.status === 'resolved',
    summary: outcome.status,
    data: { candidateId, resolve: outcome.status, matchedName: outcome.matchedName, scoreStatus: status, retriesLeft: s.limits.resolveRetries - s.resolveRetries },
  };
}

export function readPopularityOp(s: RunSession): OpOut {
  const t0 = s.now();
  const rows = DOMAINS.flatMap((d) => {
    const r = s.domainResults.get(d);
    if (!r) return [];
    const pops = r.scores.filter((x) => x.popularity !== null).map((x) => x.popularity as number);
    const spread = pops.length ? Math.max(...pops) - Math.min(...pops) : null;
    return [{ domain: d, withPopularity: pops.length, total: r.scores.length, spread: spread === null ? null : Math.round(spread * 100) / 100 }];
  });
  s.record('read_popularity', true, t0, 0, rows.map((r) => `${r.domain} ${r.withPopularity}/${r.total}`).join(', ') || 'nothing scored yet');
  return { ok: true, summary: 'popularity coverage', data: { domains: rows } };
}

// ---------------------------------------------------------------------------------------------
// optimize_bundle

const FAILED_CODES = new Set(['upstream', 'auth', 'rate_limited']);

function noScoresFailure(s: RunSession): RunFailure {
  const codes = DOMAINS.map((d) => s.domainResults.get(d)?.envelope.code);
  if (s.remainingMs() <= 0) return new RunFailure('timeout', 'The run exceeded its time limit before any scores arrived');
  if (codes.includes('rate_limited')) return new RunFailure('qloo_rate_limited', 'Qloo rate limit reached');
  return new RunFailure('qloo_unavailable', 'Qloo could not be reached for any domain');
}

export function domainStatusOf(s: RunSession): Record<Domain, DomainStatus> {
  const out = {} as Record<Domain, DomainStatus>;
  for (const d of DOMAINS) {
    const code = s.domainResults.get(d)?.envelope.code;
    out[d] = code === 'ok' ? 'ok' : code === 'empty' || code === 'no_signal' ? 'empty' : 'failed';
  }
  return out;
}

export function optimizeBundleOp(s: RunSession): OpOut {
  const t0 = s.now();
  if (s.run) {
    s.record('optimize_bundle', true, t0, 0, 'already optimized');
    return { ok: true, summary: 'already optimized', data: describeRun(s) };
  }
  if (!s.allDomainsScored()) {
    s.record('optimize_bundle', false, t0, 0, 'domains missing');
    return fail('score all four domains first (score_domain)');
  }
  // Every domain failed at the transport level: say why instead of showing an empty result.
  if (DOMAINS.every((d) => FAILED_CODES.has(s.domainResults.get(d)?.envelope.code ?? 'upstream'))) {
    s.record('optimize_bundle', false, t0, 0, 'no domain returned scores');
    throw noScoresFailure(s);
  }
  s.stage('optimize', 'start');
  try {
    s.run = runEngine(s.input, s.allScores(), s.engineConfig);
  } catch (err) {
    s.stage('optimize', 'error', s.now() - t0);
    s.record('optimize_bundle', false, t0, 0, err instanceof Error ? err.message.slice(0, 120) : 'engine error');
    if (err instanceof EngineInputError) throw new RunFailure('invalid_request', err.message, err.field);
    throw err;
  }
  s.qlooEntries = qlooEntriesFromDomainResults(
    DOMAINS.flatMap((d) => s.domainResults.get(d) ?? []),
    s.segment,
    s.candidates,
  );
  s.ledger = Ledger.merge(s.qlooEntries, s.run.ledger);
  s.stage('optimize', 'done', s.now() - t0);

  // Report chip tokens as the client knows them (a disambiguated chip carries a new token inside the run).
  const original = new Map(s.segment.interests.map((c, i) => [c.token, s.req.segment.interests[i].token]));
  const scores = s.allScores().map((x) => ({ ...x, explain: x.explain.map((e) => ({ ...e, token: original.get(e.token) ?? e.token })) }));
  s.emit({
    type: 'scores',
    scores,
    qlooLedger: s.qlooEntries,
    domainStatus: domainStatusOf(s),
    meta: s.meta('skipped', { total: 0, passed: 0, discarded: 0 }),
  });
  s.scoresEmitted = true;
  const bundle = s.run.bundle.byScenario.base;
  s.record('optimize_bundle', true, t0, 0, `bundle ${bundle.perkIds.length} perks, headline ${s.run.headline.kind}`);
  return { ok: true, summary: 'optimized', data: describeRun(s) };
}

function describeRun(s: RunSession): Record<string, unknown> {
  const run = s.run!;
  const nameOf = new Map(s.candidates.map((c) => [c.id, c.name]));
  return {
    bundle: run.bundle.byScenario.base.perkIds.map((id) => nameOf.get(id)),
    headline: run.headline.text,
    skipped: run.headline.skippedIds.map((id) => nameOf.get(id)),
    deferred: run.deferred.length,
  };
}

// ---------------------------------------------------------------------------------------------
// llm_alone

export async function llmAloneOp(s: RunSession): Promise<OpOut> {
  const t0 = s.now();
  if (s.llmAlone) {
    s.record('llm_alone', true, t0, 0, `already ${s.llmAlone.status}`);
    return { ok: true, summary: 'already done', data: { status: s.llmAlone.status } };
  }
  if (s.replay) {
    const cached = s.replay.llmAlone;
    if (cached) {
      s.emit({ type: 'llm_alone', status: cached.status, picks: cached.picks, dropped: cached.dropped });
      s.llmAlone = cached.status === 'ok' ? { status: 'ok', result: { bundleIds: cached.picks, droppedOverBudget: cached.dropped, unknownIds: 0, cached: true, promptHash: 'precache' } } : { status: 'failed', detail: 'cached failure' };
    } else {
      s.stage('llm_alone', 'skip');
      s.llmAlone = { status: 'skipped' };
    }
    s.record('llm_alone', true, t0, 0, 'replayed from precache');
    return { ok: true, summary: 'replayed', data: {} };
  }
  if (!s.useLlm) {
    s.stage('llm_alone', 'skip');
    s.llmAlone = { status: 'skipped' };
    s.record('llm_alone', true, t0, 0, 'skipped (no LLM for this run)');
    return { ok: true, summary: 'skipped', data: { status: 'skipped' } };
  }
  s.stage('llm_alone', 'start');
  const neutralCosts = Object.fromEntries(s.candidates.map((c) => [c.id, neutralCost(c, s.req.members, s.engineConfig)]));
  try {
    const result = await runLlmAlone({
      client: s.deps.llm!,
      input: { segment: s.req.segment, candidates: s.candidates, neutralCosts, budget: s.req.budget, members: s.req.members },
      timeoutMs: s.llmTimeout,
      gate: s.gate,
      cache: s.deps.llmAloneCache,
    });
    s.llmAlone = { status: 'ok', result };
    s.emit({ type: 'llm_alone', status: 'ok', picks: result.bundleIds, dropped: result.droppedOverBudget });
    s.stage('llm_alone', 'done', s.now() - t0);
    s.record('llm_alone', true, t0, 0, `${result.bundleIds.length} picked, ${result.droppedOverBudget.length} over budget${result.cached ? ' (cached)' : ''}`);
    return { ok: true, summary: 'done', data: { picked: result.bundleIds.length, droppedOverBudget: result.droppedOverBudget.length } };
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 160) : 'error';
    s.llmAlone = { status: 'failed', detail };
    s.emit({ type: 'llm_alone', status: 'failed', picks: [], dropped: [] });
    s.stage('llm_alone', 'error', s.now() - t0);
    s.record('llm_alone', false, t0, 0, detail);
    return fail(detail);
  }
}

// ---------------------------------------------------------------------------------------------
// explain

export function explainTargets(s: RunSession): CandidateFacts[] {
  const run = s.run!;
  const ids = [...new Set([...run.bundle.byScenario.base.perkIds, ...run.headline.skippedIds])];
  const byId = new Map(s.candidates.map((c) => [c.id, c]));
  return ids.flatMap((id) => {
    const c = byId.get(id);
    const f = c ? buildCandidateFacts(s.ledger!, c) : null;
    return f ? [f] : [];
  });
}

export async function explainOp(s: RunSession): Promise<OpOut> {
  const t0 = s.now();
  if (s.explain) {
    s.record('explain', true, t0, 0, 'already explained');
    return { ok: true, summary: 'already explained', data: {} };
  }
  if (!s.run || !s.ledger) {
    s.record('explain', false, t0, 0, 'no bundle yet');
    return fail('run optimize_bundle first');
  }
  const targets = explainTargets(s);
  s.stage('explain', 'start');
  let outcome: ExplainOutcome;
  if (s.useLlm) {
    outcome = await runExplain({ client: s.deps.llm!, segmentId: s.segment.id, targets, timeoutMs: s.llmTimeout, gate: s.gate });
  } else {
    const templates = s.replay?.templates ?? s.deps.sampleTemplates ?? [];
    const applied = applyTemplates(targets, templates);
    const stats = emptyStats(targets.length);
    stats.passedFirst = applied.verified.length;
    outcome = { items: applied.items, templates: [...applied.verified], stats, llm: 'ok', llmCalls: 0 };
  }
  s.explain = outcome;
  s.stage('explain', outcome.llm === 'ok' ? 'done' : 'error', s.now() - t0);
  s.stage('validate', 'done');
  s.emit({ type: 'explanations', items: outcome.items });
  const passed = outcome.templates.length;
  s.record(
    'explain',
    outcome.llm === 'ok',
    t0,
    0,
    outcome.llm === 'ok'
      ? `${passed}/${targets.length} verified${s.useLlm ? `, ${outcome.stats.repaired} repaired, ${outcome.stats.discarded} discarded` : ''}`
      : `LLM failed, code fact sentences used: ${outcome.error?.slice(0, 80) ?? ''}`,
  );
  return { ok: outcome.llm === 'ok', summary: 'explained', data: { verified: passed, discarded: outcome.stats.discarded, total: targets.length } };
}

// ---------------------------------------------------------------------------------------------
// holdout_plan

export function holdoutPlanOp(s: RunSession): OpOut {
  const t0 = s.now();
  if (!s.run) {
    s.record('holdout_plan', false, t0, 0, 'no bundle yet');
    return fail('run optimize_bundle first');
  }
  s.holdoutDone = true;
  s.record('holdout_plan', true, t0, 0, `${s.run.holdout.length} holdout rows`);
  return { ok: true, summary: 'holdout rows ready', data: { rows: s.run.holdout.length } };
}
