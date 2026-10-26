/**
 * Server-side seams between the API routes and the other layers (quota, agent, Qloo). Nothing else in the
 * UI layer touches those modules.
 */
import 'server-only';
import { CANDIDATES, DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import { DEFAULT_CONFIG, runEngine } from '@/lib/engine';
import { runPerkFit } from '@/lib/agent';
import { createQlooPort } from '@/lib/agent/qloo-port';
import type { CompareRequest, CompareResponse, RunEvent, RunRequest, SearchResponse } from '@/lib/api/types';
import { qlooEntriesFromDomainResults } from '@/lib/ledger';
import { createAiSdkClient, getModel, getModelId } from '@/lib/llm';
import { getClientIp } from '@/lib/ops/ip';
import { checkQuota } from '@/lib/ops/quota';
import { chipToken, createQlooService, createRunContext, getQlooService } from '@/lib/qloo';
import type { QlooTransport } from '@/lib/qloo/transport';
import type { SearchType } from '@/lib/qloo/types';
import type { ApiError, CandidateScore, Segment } from '@/lib/types';
import { chartPoints, type ChartPoint } from './chartData';
import { applyOverrides } from './sampleRunner';

export type QuotaKind = 'run' | 'compare' | 'search';
export type QuotaResult = { ok: true; liveRunsLeft?: number } | { ok: false; error: ApiError };

/** Example segments are served from the precache and are never counted; everything else goes through Upstash. */
export async function gateQuota(kind: QuotaKind, ip: string, opts: { example?: boolean; includeLlm?: boolean } = {}): Promise<QuotaResult> {
  if (kind === 'compare') return { ok: true }; // only example ids are accepted by the route
  if (kind === 'search') return checkQuota('search', ip);
  const run = await checkQuota('qloo_run', ip, { example: opts.example === true, qlooCalls: 4 });
  if (!run.ok) return run;
  if (opts.includeLlm && !opts.example) {
    const llm = await checkQuota('llm_run', ip);
    if (!llm.ok) return llm;
  }
  return run;
}

/** True when live mode may be offered (key present and not forced to sample). Reads only presence, never the value. */
export function liveConfigured(): boolean {
  return Boolean(process.env.QLOO_API_KEY) && process.env.PERKFIT_MODE !== 'sample';
}

function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type LiveRunner = (req: RunRequest, emit: (e: RunEvent) => void, deps: { signal: AbortSignal; ip: string }) => Promise<void>;

/** The agent run over the real Qloo service. Without an Anthropic key the deterministic orchestrator runs alone. */
export const liveRunner: LiveRunner = async (req, emit) => {
  const service = getQlooService();
  const withLlm = llmConfigured() && req.includeLlm;
  await runPerkFit(req, emit, {
    qloo: createQlooPort(service),
    precache: service.precache,
    llm: withLlm ? createAiSdkClient(getModel(), getModelId()) : null,
    loopModel: withLlm ? getModel() : null,
  });
};

/** Scores example segments (precache hits, so normally zero network calls). */
export const liveCompare = async (req: CompareRequest): Promise<CompareResponse> => {
  const service = getQlooService();
  const candidates = applyOverrides(req);
  const ctx = createRunContext({ deadlineMs: 30_000 });
  const started = Date.now();
  const results: CompareResponse['results'] = [];
  let noData = 0;
  let noMatch = 0;
  for (const id of req.against) {
    const segment: Segment | undefined = EXAMPLE_SEGMENTS.find((s) => s.id === id);
    if (!segment) continue;
    const byDomain = await service.scoreSegment(segment, candidates, ctx);
    const domainResults = Object.values(byDomain);
    const scores: CandidateScore[] = domainResults.flatMap((r) => r.scores);
    noData += scores.filter((s) => s.status === 'no_data').length;
    noMatch += scores.filter((s) => s.status === 'no_match').length;
    results.push({ segmentId: id, segment, scores, qlooLedger: qlooEntriesFromDomainResults(domainResults, segment, candidates) });
  }
  return {
    results,
    meta: {
      dataSource: ctx.stats.networkCalls > 0 ? 'live' : 'cache',
      fetchedAt: service.precache?.fetchedAt,
      qlooCalls: ctx.stats.networkCalls,
      cacheHits: ctx.stats.cacheHits,
      noData,
      noMatch,
      llm: 'skipped',
      agentSteps: 0,
      explanations: { total: 0, passed: 0, discarded: 0 },
      elapsedMs: Date.now() - started,
    },
  };
};

/** Order in which a chip name is searched. Stops at the first type with a usable answer. */
const CHIP_SEARCH_TYPES: readonly SearchType[] = ['artist', 'tv_show', 'brand', 'book', 'movie', 'podcast'];

/** Qloo entity search for the chip picker. Never auto-selects: ambiguous names come back as options. */
export async function searchEntities(q: string): Promise<SearchResponse['results']> {
  const service = getQlooService();
  const ctx = createRunContext({ deadlineMs: 20_000 });
  for (const type of CHIP_SEARCH_TYPES) {
    const out = await service.searchChip(q, type, ctx);
    if (out.pick.kind === 'resolved') {
      const e = out.pick.entity;
      return [{ token: chipToken(e.entityId), name: e.name, type, ...(e.disambiguation ? { hint: e.disambiguation } : {}) }];
    }
    if (out.pick.kind === 'ambiguous') {
      return out.pick.options.map((o) => ({ token: chipToken(o.entityId), name: o.name, type, ...(o.disambiguation ? { hint: o.disambiguation } : {}) }));
    }
    if (out.envelope.code === 'auth' || out.envelope.code === 'rate_limited') break;
  }
  return [];
}

export function clientIp(req: Request): string {
  return getClientIp(req.headers);
}

/**
 * True only for an example segment at its default inputs: the one case the precache fully answers, so the run
 * makes no Qloo or LLM call. Anything else (changed chips, costs, budget, usage, weights, answers) is counted
 * against the daily limits even when the request keeps an example id.
 */
export function isPrecachedExample(req: RunRequest): boolean {
  const ex = EXAMPLE_SEGMENTS.find((s) => s.id === req.segment.id);
  if (!ex) return false;
  const seg = req.segment;
  const sameChips =
    seg.interests.length === ex.interests.length &&
    seg.interests.every((c, i) => c.token === ex.interests[i].token && c.name === ex.interests[i].name);
  if (!sameChips || seg.age !== ex.age || (seg.gender ?? null) !== (ex.gender ?? null)) return false;
  if (req.budget !== DEFAULT_BUDGET || req.members !== DEFAULT_MEMBERS) return false;
  if (Object.keys(req.candidateOverrides ?? {}).length > 0) return false;
  if (req.answers && Object.keys(req.answers).length > 0) return false;
  if (req.domainWeights && Object.values(req.domainWeights).some((w) => w !== undefined && w !== 1)) return false;
  if (req.usage) {
    const d = DEFAULT_CONFIG.tierUsage;
    if (req.usage.high !== d.high || req.usage.mid !== d.mid || req.usage.low !== d.low) return false;
  }
  return true;
}

/** Offline transport: if scoring ever reaches for the network, it fails closed instead of calling Qloo. */
const offlineTransport: QlooTransport = () => Promise.reject(new Error('exampleHeroPoints: network calls are not allowed'));

let heroPoints: Promise<ChartPoint[] | null> | undefined;

/**
 * Example A scored from the precache only, for the chart shown before the first Run. Null when live mode is off,
 * the precache is missing, or any perk misses the cache. Never calls Qloo.
 */
export function exampleHeroPoints(): Promise<ChartPoint[] | null> {
  heroPoints ??= computeHeroPoints().catch(() => null);
  return heroPoints;
}

async function computeHeroPoints(): Promise<ChartPoint[] | null> {
  if (!liveConfigured()) return null;
  const segment = EXAMPLE_SEGMENTS.find((s) => s.id === 'example_a');
  if (!segment) return null;
  const service = createQlooService({ transport: offlineTransport });
  if (!service.precache) return null;
  const candidates = [...CANDIDATES];
  const ctx = createRunContext({ deadlineMs: 5_000 });
  const byDomain = await service.scoreSegment(segment, candidates, ctx);
  if (ctx.stats.networkCalls > 0) return null;
  const scores = Object.values(byDomain).flatMap((r) => r.scores);
  if (scores.length !== candidates.length || scores.some((s) => s.status !== 'ok')) return null;
  const result = runEngine({ segment, candidates, budget: DEFAULT_BUDGET, members: DEFAULT_MEMBERS }, scores, DEFAULT_CONFIG);
  return chartPoints(result);
}
