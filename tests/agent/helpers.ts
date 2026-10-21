import { CANDIDATES, DEFAULT_BUDGET, DEFAULT_MEMBERS, EXAMPLE_SEGMENTS } from '@/data/candidates';
import type { RunEvent, RunRequest } from '@/lib/api/types';
import type { CandidateResolution, ChipResolution, QlooPort } from '@/lib/agent/ports';
import type { DomainScoreResult, RunContext } from '@/lib/qloo/types';
import type { Candidate, CandidateScore, Domain, InterestChip, Segment } from '@/lib/types';

export type NoDataKind = 'no_match' | 'not_returned';

export interface FakePortOptions {
  /** Candidates without a usable score. */
  noData?: Record<string, NoDataKind>;
  /** Domains whose call fails at the transport level. */
  failDomains?: Domain[];
  failCode?: 'upstream' | 'rate_limited' | 'auth';
  /** Chip token -> resolution. Default: resolved with the same token. */
  chips?: Record<string, ChipResolution>;
  /** What resolveCandidate returns. When it resolves, the candidate gets a score afterwards. */
  resolveCandidate?: CandidateResolution['status'];
  /** Delay every scoreDomain call (ms), to test deadlines. */
  scoreDelayMs?: number;
}

export interface FakePort extends QlooPort {
  calls: { scoreDomain: Domain[]; resolveChip: string[]; resolveCandidate: { id: string; name: string }[]; segmentTokens: string[][] };
}

/** Affinity falls with catalog position inside a domain: the first listed candidate fits best. */
function affinityOf(c: Candidate, index: number): number {
  return Math.round((0.95 - index * 0.06) * 1000) / 1000 + (c.domain === 'book' ? 0 : 0);
}

export function makeFakePort(opts: FakePortOptions = {}): FakePort {
  const resolvedLater = new Set<string>();
  const calls: FakePort['calls'] = { scoreDomain: [], resolveChip: [], resolveCandidate: [], segmentTokens: [] };
  return {
    calls,
    createRunContext(deadlineMs) {
      return {
        deadlineAt: Date.now() + deadlineMs,
        stats: { networkCalls: 0, cacheHits: 0, retries: 0, noData: 0, noMatch: 0 },
        consecutiveRateLimited: 0,
      } satisfies RunContext;
    },
    async resolveChip(chip: InterestChip, answer?: string) {
      calls.resolveChip.push(chip.token);
      if (answer) return { status: 'resolved', token: answer };
      return opts.chips?.[chip.token] ?? { status: 'resolved', token: chip.token };
    },
    async resolveCandidate(candidate) {
      calls.resolveCandidate.push({ id: candidate.id, name: candidate.name });
      const status = opts.resolveCandidate ?? 'no_match';
      if (status === 'resolved') resolvedLater.add(candidate.id);
      return { status, matchedName: status === 'resolved' ? candidate.name : undefined };
    },
    async scoreDomain(domain, segment: Segment, candidates: Candidate[], ctx): Promise<DomainScoreResult> {
      calls.scoreDomain.push(domain);
      calls.segmentTokens.push(segment.interests.map((c) => c.token));
      if (opts.scoreDelayMs) await new Promise((r) => setTimeout(r, opts.scoreDelayMs));
      const list = candidates.filter((c) => c.domain === domain);
      const callSummary = {
        call: 'GET /v2/insights',
        params: { 'filter.type': domain, 'filter.results.entities': `n=${list.length}` },
      };
      if (opts.failDomains?.includes(domain)) {
        return {
          domain,
          envelope: { code: opts.failCode ?? 'upstream', retryable: false, latencyMs: 0, source: 'network' },
          scores: list.map((c): CandidateScore => ({ candidateId: c.id, status: 'no_data', reason: 'domain_error', affinity: null, popularity: null, explain: [] })),
          callSummary,
        };
      }
      ctx.stats.networkCalls += 1;
      const scores = list.map((c, i): CandidateScore => {
        const nd = opts.noData?.[c.id];
        if (nd && !resolvedLater.has(c.id)) {
          return { candidateId: c.id, status: nd === 'no_match' ? 'no_match' : 'no_data', reason: nd, affinity: null, popularity: null, explain: [] };
        }
        return {
          candidateId: c.id,
          status: 'ok',
          affinity: affinityOf(c, i),
          popularity: 0.97 + i * 0.005,
          explain: segment.interests.map((chip) => ({ token: chip.token, score: 0.33 })),
        };
      });
      return { domain, envelope: { code: 'ok', retryable: false, latencyMs: 1, source: 'network' }, scores, callSummary };
    },
  };
}

export function exampleRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    mode: 'live',
    segment: EXAMPLE_SEGMENTS[0],
    candidateOverrides: {},
    budget: DEFAULT_BUDGET,
    members: DEFAULT_MEMBERS,
    includeLlm: true,
    ...overrides,
  };
}

export async function collect(run: (emit: (e: RunEvent) => void) => Promise<void>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  await run((e) => events.push(e));
  return events;
}

export const eventsOfType = <T extends RunEvent['type']>(events: RunEvent[], type: T) =>
  events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

export { CANDIDATES };
