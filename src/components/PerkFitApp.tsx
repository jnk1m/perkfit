'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CandidateOverride, CompareRequest, CompareResponse, RunRequest } from '@/lib/api/types';
import type { ApiError, Candidate, Domain, RunInput, Segment } from '@/lib/types';
import { DEFAULTS, configFromRequest, hashInputs, mergeConfig } from '@/lib/ui/engine';
import { readRunStream } from '@/lib/ui/readRunStream';
import { initialState, reducer, type SegmentKey } from '@/lib/ui/reducer';
import type { ChartPoint } from '@/lib/ui/chartData';
import { chartPoints } from '@/lib/ui/chartData';
import { candidateRows, toViewModel } from '@/lib/ui/viewModel';
import { AgentTrace } from './AgentTrace';
import { AskUser } from './AskUser';
import { Banner, SAMPLE_BANNER, STALE_NOTE } from './Banners';
import { BudgetPanel } from './BudgetPanel';
import { BundleTable } from './BundleTable';
import { CandidateTable } from './CandidateTable';
import { ComparePanel } from './ComparePanel';
import { ErrorBox } from './ErrorBox';
import { Header } from './Header';
import { Headline } from './Headline';
import { Hero } from './Hero';
import { HoldoutCard } from './HoldoutCard';
import { QlooSignals } from './QlooSignals';
import { RunProgress } from './RunProgress';
import { SafeUseNote } from './SafeUseNote';
import { Section, WRAP } from './Section';
import { Summary } from './Summary';
import { ScenarioTable, SpendBar } from './SpendBar';
import { SegmentPanel } from './SegmentPanel';
import { TwoRulers } from './TwoRulers';
import { BadgeLegend } from './Badge';

const RUN_TIMEOUT_MS = 55_000;
const DOMAIN_NAME: Record<Domain, string> = { place: 'places', tv_show: 'TV shows', brand: 'brands', book: 'books' };
const EMPTY_CUSTOM: Segment = { id: 'custom', label: 'Custom segment', age: '30_to_34', interests: [] };

const segmentSig = (s: Segment) => JSON.stringify([s.id, s.age, s.gender ?? '', s.interests.map((c) => c.token)]);

async function readApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body.error && typeof body.error.code === 'string') return body.error;
  } catch {
    // fall through to the generic error below
  }
  return { code: 'internal', message: `The server answered HTTP ${res.status} without details.` };
}

export function PerkFitApp({
  examples, candidates, defaultBudget, defaultMembers, liveAvailable, heroPoints,
}: {
  examples: readonly Segment[];
  candidates: readonly Candidate[];
  defaultBudget: number;
  defaultMembers: number;
  liveAvailable: boolean;
  heroPoints: ChartPoint[] | null;
}) {
  const [state, dispatch] = useReducer(
    reducer,
    { mode: liveAvailable ? ('live' as const) : ('sample' as const), custom: EMPTY_CUSTOM, budget: defaultBudget, members: defaultMembers, usage: DEFAULTS.tierUsage },
    initialState,
  );
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- derived inputs --------------------------------------------------------------------------------
  const segment: Segment = state.active === 'custom' ? state.custom : (examples.find((s) => s.id === state.active) ?? examples[0]);
  const cands = useMemo<Candidate[]>(() => candidates.map((c) => ({ ...c, ...state.overrides[c.id] })), [candidates, state.overrides]);
  const cfg = useMemo(() => mergeConfig(configFromRequest({ usage: state.usage })), [state.usage]);
  const input = useMemo<RunInput>(
    () => ({ segment, candidates: cands, budget: state.budget, members: state.members, domainWeights: state.weights }),
    [segment, cands, state.budget, state.members, state.weights],
  );

  const shown = state.shown;
  const viewInput = useMemo<RunInput>(() => (shown ? { ...input, segment: shown.snapshot.input.segment } : input), [input, shown]);
  const stale = shown ? hashInputs(viewInput, cfg) !== shown.snapshot.hash : false;
  const segmentChanged = shown ? segmentSig(segment) !== segmentSig(shown.snapshot.input.segment) : false;
  const running = state.phase === 'running';

  const vm = useMemo(() => {
    if (!shown?.scores) return null;
    const other = state.compare.other ? { input: { ...viewInput, segment: state.compare.other.segment }, scores: state.compare.other.scores } : null;
    return toViewModel({
      input: viewInput, cfg, scores: shown.scores, dataSource: shown.meta?.dataSource ?? 'sample',
      snapshot: { input: shown.snapshot.input, cfg: shown.snapshot.cfg, scores: shown.scores },
      llm: shown.llm ?? null, explanations: shown.explanations ?? null, explanationsPending: running, stale, other,
    });
  }, [shown, viewInput, cfg, running, stale, state.compare.other]);

  const rows = useMemo(() => candidateRows(input, shown?.scores ?? null, vm?.result ?? null), [input, shown, vm]);
  const sampleView = state.mode === 'sample' || shown?.meta?.dataSource === 'sample';
  const qlooBadge = sampleView ? 'sample' : 'qloo';
  const failedDomains = shown?.domainStatus ? (Object.keys(shown.domainStatus) as Domain[]).filter((d) => shown.domainStatus?.[d] === 'failed') : [];

  // Scroll to a new result once per run.
  const shownRunId = shown?.runId;
  useEffect(() => {
    if (shownRunId === undefined) return;
    const id = requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [shownRunId]);

  // ---- actions ---------------------------------------------------------------------------------------
  async function startCompare(runId: number, runSegment: Segment) {
    const target = runSegment.id === 'example_b' ? 'example_a' : 'example_b';
    const body: CompareRequest = { mode: state.mode, against: [target], candidateOverrides: state.overrides };
    dispatch({ type: 'compare_start' });
    try {
      const res = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw await readApiError(res);
      const data = (await res.json()) as CompareResponse;
      if (runIdRef.current !== runId) return;
      const r = data.results[0];
      if (!r) throw { code: 'internal', message: 'The comparison returned no segment.' } satisfies ApiError;
      dispatch({ type: 'compare_ready', other: { segment: r.segment, scores: r.scores } });
    } catch (err) {
      if (runIdRef.current !== runId) return;
      const apiErr: ApiError = typeof err === 'object' && err !== null && 'code' in err ? (err as ApiError) : { code: 'internal', message: err instanceof Error ? err.message : 'Comparison failed.' };
      dispatch({ type: 'compare_fail', error: apiErr });
    }
  }

  async function run(answers: Record<string, string> = state.answers) {
    abortRef.current?.abort();
    const runId = ++runIdRef.current;
    const ctl = new AbortController();
    abortRef.current = ctl;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, RUN_TIMEOUT_MS);
    const runSegment = segment;
    dispatch({ type: 'run_start', runId, snapshot: { input, cfg, hash: hashInputs(input, cfg) } });
    const body: RunRequest = {
      mode: state.mode, segment: runSegment, candidateOverrides: state.overrides as Record<string, CandidateOverride>, budget: state.budget,
      members: state.members, domainWeights: state.weights, usage: state.usage, includeLlm: state.includeLlm, answers,
    };
    try {
      const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!res.ok || !res.body) {
        dispatch({ type: 'run_fail', runId, error: await readApiError(res) });
        return;
      }
      let finished = false;
      for await (const event of readRunStream(res.body)) {
        dispatch({ type: 'event', runId, event });
        if (event.type === 'done' || event.type === 'error' || event.type === 'ask_user') finished = true;
        if (event.type === 'scores' && runSegment.id !== 'custom') void startCompare(runId, runSegment);
      }
      if (finished) dispatch({ type: 'run_end', runId });
      else dispatch({ type: 'run_fail', runId, error: { code: 'internal', message: 'The result stream ended before the run finished.' } });
    } catch (err) {
      if (timedOut) dispatch({ type: 'run_fail', runId, error: { code: 'timeout', message: `No complete answer within ${RUN_TIMEOUT_MS / 1000} seconds.` } });
      else if (!ctl.signal.aborted) dispatch({ type: 'run_fail', runId, error: { code: 'internal', message: err instanceof Error ? err.message : 'The run failed.' } });
    } finally {
      clearTimeout(timer);
    }
  }

  const select = (key: SegmentKey) => dispatch({ type: 'select_segment', key, segment: key === 'custom' ? state.custom : (examples.find((s) => s.id === key) ?? examples[0]) });
  const answer = (questionId: string, token: string) => {
    dispatch({ type: 'set_answer', questionId, token });
    void run({ ...state.answers, [questionId]: token });
  };

  const noChips = segment.interests.length === 0;
  const blockedReason = noChips ? 'Add at least one interest chip.' : state.mode === 'live' && !liveAvailable ? 'Live mode is not available here. Switch to sample mode.' : null;
  const shortName = segment.id === 'custom' ? 'Custom' : segment.label.split(':')[0];
  const runLabel = stale && shown && !segmentChanged ? 'Run again' : `Run ${shortName}`;
  const dim = segmentChanged || (running && state.current !== shown);
  const heroVisible = !vm && !running;
  const [candOpen, setCandOpen] = useState(false);
  const label = 'label mb-4 font-semibold text-sienna';
  const points = vm ? chartPoints(vm.result) : null;

  return (
    <>
      <Header mode={state.mode} liveAvailable={liveAvailable} meta={shown?.meta ?? null} onMode={(m) => dispatch({ type: 'set_mode', mode: m })} />
      <main>
        <section aria-label="Inputs" className="border-y border-ink">
          <div className={`${WRAP} grid lg:grid-cols-[1.1fr_1.1fr_0.8fr]`}>
            <div className="py-8 lg:pr-8">
              <h2 className={label}>I. The audience</h2>
              <SegmentPanel
                segment={segment}
                active={state.active}
                onSelect={select}
                onChange={(next) => dispatch({ type: 'edit_custom', segment: { ...next, id: 'custom', label: 'Custom segment' } })}
              />
            </div>
            <div className="border-t border-ink py-8 lg:border-l lg:border-t-0 lg:px-8">
              <h2 className={label}>II. The budget</h2>
              <BudgetPanel
                budget={state.budget} members={state.members} usage={state.usage} weights={state.weights} includeLlm={state.includeLlm}
                running={running} canRun={blockedReason === null} blockedReason={blockedReason} runLabel={runLabel}
                onBudget={(v) => dispatch({ type: 'set_budget', value: v })} onMembers={(v) => dispatch({ type: 'set_members', value: v })}
                onUsage={(t, v) => dispatch({ type: 'set_usage', tier: t, value: v })} onWeight={(d, v) => dispatch({ type: 'set_weight', domain: d, value: v })}
                onIncludeLlm={(v) => dispatch({ type: 'set_include_llm', value: v })} onRun={() => void run()}
              />
            </div>
            <div className="border-t border-ink py-8 lg:border-l lg:border-t-0 lg:pl-8">
              <h2 className={label}>III. Candidates</h2>
              <p className="font-display text-[56px] leading-none tabular-nums">{cands.length}</p>
              <p className="mt-2 text-sm text-muted">candidate perks, with price, effort and taste match</p>
              <button
                type="button"
                aria-expanded={candOpen}
                aria-controls="candidate-table"
                onClick={() => setCandOpen((o) => !o)}
                className="label mt-4 flex min-h-11 w-full items-center justify-between border-t border-ink pt-2 font-semibold transition-colors hover:text-bottle md:min-h-9"
              >
                <span>{candOpen ? 'Hide table' : 'Show table'}</span>
                <span aria-hidden>{candOpen ? '−' : '+'}</span>
              </button>
            </div>
          </div>
          {candOpen && (
            <div id="candidate-table" className="border-t border-ink">
              <div className={`${WRAP} space-y-3 py-6`}>
                <CandidateTable rows={rows} qlooBadge={qlooBadge} onEdit={(id, override) => dispatch({ type: 'edit_candidate', id, override })} />
              </div>
            </div>
          )}
        </section>

        {(sampleView || segmentChanged || (stale && !segmentChanged) || failedDomains.length > 0 || state.ask || state.error) && (
          <div className={`${WRAP} space-y-3 pt-6`}>
            {sampleView && <Banner>{SAMPLE_BANNER}</Banner>}
            {segmentChanged && <Banner tone="assume">Segment changed. Press Run.</Banner>}
            {stale && !segmentChanged && <Banner tone="assume">{STALE_NOTE}</Banner>}
            {failedDomains.length > 0 && (
              <Banner tone="assume">
                Qloo did not answer for {failedDomains.map((d) => DOMAIN_NAME[d]).join(', ')}. Those perks are on hold.{' '}
                <button type="button" onClick={() => void run()} className="ml-2 min-h-11 border border-ink px-4 text-ink transition-colors hover:bg-ink hover:text-paper md:min-h-8">Retry</button>
              </Banner>
            )}
            {state.ask && <AskUser ask={state.ask} onAnswer={answer} />}
            {state.error && <ErrorBox error={state.error} onRetry={() => void run()} onSample={() => dispatch({ type: 'set_mode', mode: 'sample' })} />}
          </div>
        )}

        <div ref={resultRef} className="scroll-mt-4">
          {heroVisible ? (
            <Hero points={heroPoints} />
          ) : (
            <section id="result" aria-labelledby="result-h" className="field-ink">
              <div className={`${WRAP} pb-14 pt-16`}>
                <div className="label mb-8 flex justify-between gap-4 font-semibold text-tint-sand sm:mb-[34px]">
                  <span>This month&rsquo;s picks &middot; {segment.label}</span>
                  <h2 id="result-h">{running && !vm ? 'Scoring…' : 'Result'}</h2>
                </div>
                <RunProgress stages={state.stages} visible={running} />
                {vm && (
                  <div key={shownRunId} className={`rise ${running ? 'mt-8' : ''} ${dim ? 'opacity-50' : ''}`}>
                    {vm.summary && <Summary summary={vm.summary} />}
                    <Headline vm={vm.headline} />
                    <QlooSignals chips={segment.interests.length} perks={cands.length} categories={new Set(cands.map((c) => c.domain)).size} meta={shown?.meta ?? null} />
                    <SpendBar spend={vm.spend} domains={Object.fromEntries(cands.map((c) => [c.id, c.domain]))} />
                    {points && points.length > 0 && (
                      <div className="mt-12">
                        <TwoRulers points={points} variant="ink" />
                      </div>
                    )}
                    <details className="group mt-6 border-t border-on-dark/25 pt-3">
                      <summary className="flex cursor-pointer list-none justify-between text-[13px] text-on-dark-muted [&::-webkit-details-marker]:hidden">
                        <span>Usage cases</span>
                        <span><span className="group-open:hidden">Show table +</span><span className="hidden group-open:inline">Hide table &minus;</span></span>
                      </summary>
                      <div className="mt-4">
                        <ScenarioTable rows={vm.scenarios} showSaved />
                        {vm.sensitivity && <p className="mt-3 text-sm text-on-dark-muted">{vm.sensitivity}</p>}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {vm && (
          <div className={dim ? 'opacity-50' : undefined}>
            <Section id="why" title="Best bundle" hint="Five perks, ranked by taste fit, then value">
              <BundleTable rows={vm.bundle} openId={openWhy} onToggle={(id) => setOpenWhy(openWhy === id ? null : id)} qlooBadge={qlooBadge} />
              {vm.onHold.length > 0 && (
                <p className="mt-4 text-sm">
                  <span className="font-semibold">On hold: no Qloo data. Nothing fills the gap.</span> {vm.onHold.map((h) => `${h.name} (${h.why})`).join(', ')}
                </p>
              )}
              <div className="mt-6"><BadgeLegend /></div>
            </Section>

            <div className="mt-14">
              <Section id="compare" title="What if…" hint="Three ways the answer could have been different" tone="bottle">
                <ComparePanel
                  cards={vm.cards}
                  compare={state.compare}
                  running={running}
                  llmRequested={state.includeLlm}
                  canCompareWithB={segment.id === 'custom' && !noChips && !!shown}
                  onCompare={() => void startCompare(runIdRef.current, segment)}
                />
              </Section>
            </div>

            <Section id="holdout" title="How to test it" hint="Taste match is a hypothesis. Here is how to check it.">
              <HoldoutCard rows={vm.holdout} intro={vm.holdoutIntro} />
            </Section>
          </div>
        )}

        <div className={`${WRAP} pt-6`}>
          <AgentTrace
            steps={shown?.trace}
            summary={shown?.meta ? `${shown.meta.agentSteps} steps, ${shown.meta.qlooCalls} Qloo calls, explanations ${shown.meta.explanations.passed}/${shown.meta.explanations.total}` : undefined}
          />
        </div>
      </main>
      <SafeUseNote variant="footer" />
    </>
  );
}
