'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CandidateOverride, CompareRequest, CompareResponse, RunRequest } from '@/lib/api/types';
import type { ApiError, Candidate, Domain, RunInput, Segment } from '@/lib/types';
import { DEFAULTS, configFromRequest, hashInputs, mergeConfig } from '@/lib/ui/engine';
import { usd } from '@/lib/ui/format';
import { readRunStream } from '@/lib/ui/readRunStream';
import { initialState, reducer, type SegmentKey } from '@/lib/ui/reducer';
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
import { HoldoutCard } from './HoldoutCard';
import { RunProgress } from './RunProgress';
import { SafeUseNote } from './SafeUseNote';
import { Section } from './Section';
import { ScenarioTable, SpendBar } from './SpendBar';
import { SegmentPanel } from './SegmentPanel';

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
  examples, candidates, defaultBudget, defaultMembers, liveAvailable,
}: {
  examples: readonly Segment[];
  candidates: readonly Candidate[];
  defaultBudget: number;
  defaultMembers: number;
  liveAvailable: boolean;
}) {
  const [state, dispatch] = useReducer(
    reducer,
    { mode: liveAvailable ? ('live' as const) : ('sample' as const), custom: EMPTY_CUSTOM, budget: defaultBudget, members: defaultMembers, usage: DEFAULTS.tierUsage },
    initialState,
  );
  const [openWhy, setOpenWhy] = useState<string | null | undefined>(undefined);
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
  const effectiveOpen = openWhy === undefined ? (vm?.bundle[0]?.id ?? null) : openWhy;
  const failedDomains = shown?.domainStatus ? (Object.keys(shown.domainStatus) as Domain[]).filter((d) => shown.domainStatus?.[d] === 'failed') : [];

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
  const runLabel = stale && shown && !segmentChanged ? 'Re-run (refreshes AI text)' : `Run with ${segment.label}`;
  const dim = segmentChanged || (running && state.current !== shown);

  return (
    <>
      <Header
        mode={state.mode}
        liveAvailable={liveAvailable}
        meta={shown?.meta ?? null}
        onMode={(m) => dispatch({ type: 'set_mode', mode: m })}
        summary={vm ? { text: vm.headline.text, spend: `${usd(vm.spend.used)} of ${usd(vm.spend.budget)}` } : null}
      />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6">
        <p className="max-w-3xl text-sm text-ink/85">
          Pick partner perks for a customer segment by taste, inside a budget. Qloo ranks how well each perk fits the segment; costs and usage are editable assumptions.
        </p>
        {sampleView && <Banner>{SAMPLE_BANNER}</Banner>}

        <Section id="input" n={1} title="Segment">
          <SegmentPanel
            segment={segment}
            active={state.active}
            onSelect={select}
            onChange={(next) => dispatch({ type: 'edit_custom', segment: { ...next, id: 'custom', label: 'Custom segment' } })}
          />
        </Section>

        <Section id="perks" n={2} title={`Partner perks (${cands.length})`}>
          <CandidateTable rows={rows} qlooBadge={qlooBadge} onEdit={(id, override) => dispatch({ type: 'edit_candidate', id, override })} />
        </Section>

        <Section id="budget" n={3} title="Budget and run">
          <BudgetPanel
            budget={state.budget} members={state.members} usage={state.usage} weights={state.weights} includeLlm={state.includeLlm}
            running={running} canRun={blockedReason === null} blockedReason={blockedReason} runLabel={runLabel}
            onBudget={(v) => dispatch({ type: 'set_budget', value: v })} onMembers={(v) => dispatch({ type: 'set_members', value: v })}
            onUsage={(t, v) => dispatch({ type: 'set_usage', tier: t, value: v })} onWeight={(d, v) => dispatch({ type: 'set_weight', domain: d, value: v })}
            onIncludeLlm={(v) => dispatch({ type: 'set_include_llm', value: v })} onRun={() => void run()}
          />
          <div className="mt-4 space-y-3">
            <RunProgress stages={state.stages} visible={running} />
            {state.ask && <AskUser ask={state.ask} onAnswer={answer} />}
            {state.error && <ErrorBox error={state.error} onRetry={() => void run()} onSample={() => dispatch({ type: 'set_mode', mode: 'sample' })} />}
          </div>
        </Section>

        {segmentChanged && <Banner tone="assume">Segment changed. Press Run.</Banner>}
        {stale && !segmentChanged && <Banner tone="assume">{STALE_NOTE}</Banner>}
        {failedDomains.length > 0 && (
          <Banner tone="assume">
            Qloo did not answer for {failedDomains.map((d) => DOMAIN_NAME[d]).join(', ')}. Those perks are on hold.{' '}
            <button type="button" onClick={() => void run()} className="ml-2 h-11 border border-ink px-3 text-ink md:h-8">Retry</button>
          </Banner>
        )}

        <div className={dim ? 'space-y-8 opacity-50' : 'space-y-8'}>
          <Section id="result" n={4} title="Result">
            {vm ? (
              <>
                <Headline vm={vm.headline} />
                <SpendBar spend={vm.spend} />
                <ScenarioTable rows={vm.scenarios} showSaved={vm.headline.range !== null} />
              </>
            ) : (
              <p className="text-sm text-ink/80">{running ? 'Scoring…' : 'Press Run to score the perks for this segment.'}</p>
            )}
          </Section>

          {vm && (
            <>
              <Section id="why" n={5} title="Bundle">
                <BundleTable rows={vm.bundle} openId={effectiveOpen} onToggle={(id) => setOpenWhy(effectiveOpen === id ? null : id)} qlooBadge={qlooBadge} />
                {vm.skipped.length > 0 && <p className="mt-3 text-sm"><span className="font-semibold">Skipped: popular, low taste fit.</span> {vm.skipped.join(', ')}</p>}
                {vm.onHold.length > 0 && (
                  <p className="mt-1 text-sm">
                    <span className="font-semibold">On hold: no Qloo data. Nothing fills the gap.</span> {vm.onHold.map((h) => `${h.name} (${h.why})`).join(', ')}
                  </p>
                )}
              </Section>

              <Section id="holdout" n={6} title="Holdout plan">
                <HoldoutCard rows={vm.holdout} />
              </Section>

              <Section id="compare" n={7} title="Compare">
                <ComparePanel
                  cards={vm.cards}
                  compare={state.compare}
                  running={running}
                  llmRequested={state.includeLlm}
                  canCompareWithB={segment.id === 'custom' && !noChips && !!shown}
                  onCompare={() => void startCompare(runIdRef.current, segment)}
                />
              </Section>
            </>
          )}
        </div>

        <AgentTrace steps={shown?.trace} />
        <SafeUseNote variant="footer" />
      </main>
    </>
  );
}
