/**
 * Sample-mode runner: emits the same RunEvent sequence as the live agent, using the hand-written scores
 * in `data/sample/scores.ts` and code-written sentences. No Qloo calls, no LLM calls.
 */
import { CANDIDATES } from '@/data/candidates';
import { sampleScoresFor } from '@/data/sample/scores';
import type { RunEvent, RunRequest, RunStage } from '@/lib/api/types';
import type { Candidate, CandidateScore, Domain, LedgerEntry, RunInput } from '@/lib/types';
import { DOMAINS } from '@/lib/types';
import { configFromRequest, runEngine } from './engine';

export const AMBIGUOUS_SAMPLE_TOKEN = 'sample-amb-dune';

const DOMAIN_LABEL: Record<Domain, string> = { place: 'place', tv_show: 'TV show', brand: 'brand', book: 'book' };

export function applyOverrides(req: Pick<RunRequest, 'candidateOverrides'>): Candidate[] {
  return CANDIDATES.map((c) => ({ ...c, ...req.candidateOverrides[c.id] }));
}

export function toRunInput(req: RunRequest): RunInput {
  return {
    segment: req.segment,
    candidates: applyOverrides(req),
    budget: req.budget,
    members: req.members,
    domainWeights: req.domainWeights,
  };
}

function sampleLedger(scores: CandidateScore[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let seq = 1;
  for (const s of scores) {
    if (s.status !== 'ok' || s.affinity === null) continue;
    out.push({ id: `sample.affinity.${s.candidateId}`, seq: seq++, source: 'sample', candidateId: s.candidateId, field: 'affinity', value: s.affinity, unit: 'ratio' });
    if (s.popularity !== null) out.push({ id: `sample.popularity.${s.candidateId}`, seq: seq++, source: 'sample', candidateId: s.candidateId, field: 'popularity', value: s.popularity, unit: 'ratio' });
  }
  return out;
}

export async function runSample(
  req: RunRequest,
  emit: (e: RunEvent) => void,
  opts: { delayMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const delay = opts.delayMs ?? 140;
  const pause = () => new Promise<void>((r) => setTimeout(r, delay));
  const aborted = () => opts.signal?.aborted === true;
  const started = Date.now();
  const stage = (s: RunStage, status: 'start' | 'done' | 'skip', ms?: number) => emit({ type: 'stage', stage: s, status, ms });

  // Demo of the disambiguation step: a chip that matches more than one entity asks the user to pick.
  if (req.segment.interests.some((c) => c.token === AMBIGUOUS_SAMPLE_TOKEN) && !req.answers?.dune) {
    stage('resolve', 'start');
    emit({
      type: 'ask_user',
      questionId: 'dune',
      question: 'Which "Dune" do you mean?',
      options: [
        { token: 'sample-dune-novel', name: 'Dune (novel)', hint: 'book, 1965' },
        { token: 'sample-dune-film', name: 'Dune (film)', hint: 'film, 2021' },
      ],
    });
    return;
  }

  stage('resolve', 'start');
  await pause();
  stage('resolve', 'done', delay);

  const scores = sampleScoresFor(req.segment);
  const domains: Domain[] = [...DOMAINS];
  const stageOf = (d: Domain): RunStage => `score_${d}` as RunStage;
  if (req.includeLlm) stage('llm_alone', 'start');
  for (const d of domains) stage(stageOf(d), 'start');
  await pause();
  if (aborted()) return;
  for (const d of domains) stage(stageOf(d), 'done', delay);

  const domainStatus = Object.fromEntries(
    domains.map((d) => [d, scores.some((s) => s.status === 'ok' && CANDIDATES.find((c) => c.id === s.candidateId)?.domain === d) ? 'ok' : 'empty']),
  ) as Record<Domain, 'ok' | 'empty'>;
  const noData = scores.filter((s) => s.status === 'no_data').length;
  const noMatch = scores.filter((s) => s.status === 'no_match').length;
  const baseMeta = {
    dataSource: 'sample' as const,
    qlooCalls: 0,
    cacheHits: 0,
    noData,
    noMatch,
    llm: 'skipped' as const,
    agentSteps: 0,
    explanations: { total: 0, passed: 0, discarded: 0 },
    elapsedMs: Date.now() - started,
  };
  emit({ type: 'scores', scores, qlooLedger: sampleLedger(scores), domainStatus, meta: baseMeta });

  const input = toRunInput(req);
  stage('optimize', 'start');
  const result = runEngine(input, scores, configFromRequest({ usage: req.usage }));
  await pause();
  stage('optimize', 'done', delay);

  if (req.includeLlm) {
    // Stand-in for "an LLM alone": the popularity bundle with its last pick removed, plus one pick that
    // the code drops for exceeding the budget.
    const picks = result.baseline.perkIds.slice(0, -1);
    const over = result.perks
      .filter((p) => !result.baseline.perkIds.includes(p.candidateId))
      .sort((a, b) => b.scn.base.monthlyCost - a.scn.base.monthlyCost)[0];
    emit({ type: 'llm_alone', status: 'ok', picks, dropped: over ? [over.candidateId] : [] });
    stage('llm_alone', 'done', delay);
  } else {
    stage('llm_alone', 'skip');
  }

  stage('explain', 'start');
  const byId = new Map(result.perks.map((p) => [p.candidateId, p]));
  const items = result.bundle.byScenario.base.perkIds.map((id) => {
    const p = byId.get(id)!;
    return {
      candidateId: id,
      sentence: `${p.name} ranks ${p.rank} of ${p.domainN} among ${DOMAIN_LABEL[p.domain]} candidates by taste affinity for this segment (taste fit ${p.tier}). Sample value, not from Qloo.`,
      status: 'verified' as const,
      failedRules: [],
    };
  });
  await pause();
  emit({ type: 'explanations', items });
  stage('explain', 'done', delay);
  stage('validate', 'skip');
  emit({ type: 'done', meta: { ...baseMeta, explanations: { total: items.length, passed: items.length, discarded: 0 }, elapsedMs: Date.now() - started } });
}
