/**
 * Server-side seams between the API routes and the other layers (quota, agent, Qloo). Nothing else in the
 * UI layer touches those modules.
 */
import 'server-only';
import { EXAMPLE_SEGMENTS } from '@/data/candidates';
import { runPerkFit } from '@/lib/agent';
import { createQlooPort } from '@/lib/agent/qloo-port';
import type { CompareRequest, CompareResponse, RunEvent, RunRequest, SearchResponse } from '@/lib/api/types';
import { qlooEntriesFromDomainResults } from '@/lib/ledger';
import { createAiSdkClient, getModel, getModelId } from '@/lib/llm';
import { checkQuota } from '@/lib/ops/quota';
import { chipToken, createRunContext, getQlooService } from '@/lib/qloo';
import type { SearchType } from '@/lib/qloo/types';
import type { ApiError, CandidateScore, Segment } from '@/lib/types';
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
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'local';
}
