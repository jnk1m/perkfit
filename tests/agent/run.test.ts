import { describe, expect, it } from 'vitest';
import { hashInputs } from '@/lib/engine';
import { withRunExtras } from '@/lib/agent/extras';
import { runPerkFit } from '@/lib/agent/run';
import type { AgentDeps, RunArtifacts } from '@/lib/agent/ports';
import { LlmError } from '@/lib/llm/client';
import { LlmAloneCache } from '@/lib/llm/llm-alone';
import type { RunEvent } from '@/lib/api/types';
import { FakeLlm, mockLoopModel, templateFromPrompt, textStep, toolStep } from '../helpers/fake-llm';
import { collect, eventsOfType, exampleRequest, makeFakePort } from './helpers';

const ALONE = { ranked: ['joes_pizza', 'shake_shack', 'katz', 'levain', 'succession'] };
const explainReply = (req: Parameters<typeof templateFromPrompt>[0]) => templateFromPrompt(req);

function deps(over: Partial<AgentDeps> = {}): AgentDeps {
  return { qloo: makeFakePort(), sampleMode: false, llmAloneCache: new LlmAloneCache(), ...over };
}
const types = (events: RunEvent[]) => events.map((e) => e.type);
const doneOf = (events: RunEvent[]) => eventsOfType(events, 'done')[0];
const toolsOf = (events: RunEvent[]) => eventsOfType(events, 'trace')[0].steps.map((s) => s.tool);

describe('deterministic pipeline (no loop model)', () => {
  it('sample mode: no LLM, code fact sentences, trace and done', async () => {
    const llm = new FakeLlm([]);
    const events = await collect((emit) => runPerkFit(exampleRequest({ mode: 'sample' }), emit, deps({ llm, sampleMode: true })));
    expect(llm.calls).toHaveLength(0);
    expect(types(events)).toContain('scores');
    expect(types(events).at(-1)).toBe('done');
    const done = doneOf(events);
    expect(done.meta).toMatchObject({ dataSource: 'sample', llm: 'skipped', qlooCalls: 4 });
    const expl = eventsOfType(events, 'explanations')[0];
    expect(expl.items.length).toBeGreaterThan(0);
    expect(expl.items.every((i) => i.status === 'verified' && /taste fit/.test(i.sentence ?? ''))).toBe(true);
    const stage = eventsOfType(events, 'stage').find((e) => e.stage === 'llm_alone');
    expect(stage?.status).toBe('skip');
    expect(eventsOfType(events, 'llm_alone')).toHaveLength(0);
  });

  it('with an LLM client: llm_alone and explain run once each and the explanations verify', async () => {
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm })));
    expect(llm.calls.map((c) => c.purpose)).toEqual(['llm_alone', 'explain']);
    const alone = eventsOfType(events, 'llm_alone')[0];
    expect(alone.status).toBe('ok');
    expect(alone.picks.length + alone.dropped.length).toBe(5);
    const expl = eventsOfType(events, 'explanations')[0];
    expect(expl.items.every((i) => i.status === 'verified' && i.failedRules.length === 0)).toBe(true);
    expect(expl.items[0].sentence).toMatch(/percentile/);
    const meta = doneOf(events).meta;
    expect(meta.llm).toBe('ok');
    expect(meta.explanations.total).toBe(expl.items.length);
    expect(meta.explanations.passed).toBe(expl.items.length);
    expect(meta.explanations.discarded).toBe(0);
    // llm_alone runs next to scoring, so its trace row lands wherever it finishes.
    expect(toolsOf(events).filter((t) => t !== 'llm_alone')).toEqual([
      'resolve_chip', 'resolve_chip', 'resolve_chip',
      'score_domain', 'score_domain', 'score_domain', 'score_domain',
      'optimize_bundle', 'explain', 'holdout_plan',
    ]);
    expect(toolsOf(events)).toContain('llm_alone');
  });

  it('events come in a client-friendly order: scores before explanations before trace before done', async () => {
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm })));
    const t = types(events).filter((x) => x !== 'stage');
    const idx = (x: string) => t.indexOf(x as never);
    expect(idx('scores')).toBeLessThan(idx('explanations'));
    expect(idx('explanations')).toBeLessThan(idx('trace'));
    expect(idx('trace')).toBeLessThan(idx('done'));
    expect(t.filter((x) => x === 'scores')).toHaveLength(1);
  });

  it('scores event carries Qloo ledger entries and per-domain status without entity ids', async () => {
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps()));
    const sc = eventsOfType(events, 'scores')[0];
    expect(sc.domainStatus).toEqual({ place: 'ok', tv_show: 'ok', brand: 'ok', book: 'ok' });
    expect(sc.qlooLedger.length).toBeGreaterThan(20);
    expect(sc.scores).toHaveLength(20);
    expect(JSON.stringify(sc)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('T13: an LLM outage keeps the run alive with fact sentences and llm failed', async () => {
    const llm = new FakeLlm([new LlmError('timeout', 'slow'), new LlmError('provider', 'down')]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm })));
    expect(eventsOfType(events, 'llm_alone')[0].status).toBe('failed');
    const expl = eventsOfType(events, 'explanations')[0];
    expect(expl.items.every((i) => /taste fit/.test(i.sentence ?? ''))).toBe(true);
    expect(doneOf(events).meta.llm).toBe('failed');
  });

  it('T12: all templates rejected shows no sentence for any perk and reports the rate', async () => {
    const badReply = (req: Parameters<typeof templateFromPrompt>[0]) => templateFromPrompt(req, (i) => (i.text = 'about 83 percent'));
    const llm = new FakeLlm([ALONE, badReply, badReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm })));
    const expl = eventsOfType(events, 'explanations')[0];
    expect(expl.items.every((i) => i.sentence === null && i.status === 'discarded')).toBe(true);
    const meta = doneOf(events).meta;
    expect(meta.explanations).toEqual({ total: expl.items.length, passed: 0, discarded: expl.items.length });
    expect(eventsOfType(events, 'scores')).toHaveLength(1);
  });

  it('sample mode serves stored templates, re-checked against the current ledger, with no LLM', async () => {
    let art: RunArtifacts | undefined;
    await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm: new FakeLlm([ALONE, explainReply]), onArtifacts: (a) => (art = a) })));
    const idle = new FakeLlm([]);
    const events = await collect((emit) =>
      runPerkFit(exampleRequest({ mode: 'sample' }), emit, deps({ llm: idle, sampleMode: true, sampleTemplates: art!.templates })),
    );
    expect(idle.calls).toHaveLength(0);
    const items = eventsOfType(events, 'explanations')[0].items;
    expect(items.every((i) => /percentile/.test(i.sentence ?? ''))).toBe(true);
    expect(doneOf(events).meta).toMatchObject({ dataSource: 'sample', llm: 'skipped', explanations: { passed: items.length, discarded: 0 } });
  });

  it('includeLlm false never touches the LLM even when a client is configured', async () => {
    const llm = new FakeLlm([]);
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ llm })));
    expect(llm.calls).toHaveLength(0);
    expect(doneOf(events).meta.llm).toBe('skipped');
  });
});

describe('failures and limits', () => {
  it('all four domains failing is reported once as an error, with no scores event', async () => {
    const qloo = makeFakePort({ failDomains: ['place', 'tv_show', 'brand', 'book'], failCode: 'rate_limited' });
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ qloo })));
    expect(eventsOfType(events, 'error')[0].error.code).toBe('qloo_rate_limited');
    expect(types(events)).not.toContain('scores');
    expect(types(events)).not.toContain('done');
  });

  it('one failing domain still produces a result, marked failed', async () => {
    const qloo = makeFakePort({ failDomains: ['book'] });
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ qloo })));
    const sc = eventsOfType(events, 'scores')[0];
    expect(sc.domainStatus.book).toBe('failed');
    expect(sc.domainStatus.place).toBe('ok');
    expect(sc.scores.filter((s) => s.reason === 'domain_error')).toHaveLength(5);
    expect(doneOf(events).meta.noData).toBe(5);
  });

  it('an unknown candidate override is an invalid_request naming the field', async () => {
    const req = exampleRequest({ candidateOverrides: { nope: { unitCost: 1, billing: 'fixed', friction: 1 } } });
    const events = await collect((emit) => runPerkFit(req, emit, deps()));
    expect(events).toHaveLength(1);
    expect(eventsOfType(events, 'error')[0].error).toMatchObject({ code: 'invalid_request', field: 'candidateOverrides.nope' });
  });

  it('an engine input error (budget 0) becomes invalid_request with the field, after scoring', async () => {
    const events = await collect((emit) => runPerkFit(exampleRequest({ budget: 0, includeLlm: false }), emit, deps()));
    expect(eventsOfType(events, 'error')[0].error).toMatchObject({ code: 'invalid_request', field: 'budget' });
  });

  it('an exhausted deadline skips LLM calls instead of hanging, and still finishes', async () => {
    const llm = new FakeLlm([]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, limits: { deadlineMs: 500 } })));
    expect(llm.calls).toHaveLength(0);
    expect(doneOf(events).meta.llm).toBe('failed');
  });

  it('overrides change the engine input (a fixed-fee perk costs the same at any usage)', async () => {
    const req = exampleRequest({ includeLlm: false, candidateOverrides: { katz: { unitCost: 100000, billing: 'fixed', friction: 1 } } });
    const events = await collect((emit) => runPerkFit(req, emit, deps()));
    const ledger = eventsOfType(events, 'scores')[0].qlooLedger;
    expect(ledger.length).toBeGreaterThan(0);
    expect(doneOf(events)).toBeDefined();
  });
});

describe('chips and ask_user', () => {
  const ambiguous = { a1: { status: 'ambiguous' as const, options: [{ token: 'c_ONE', name: 'Fleabag (play)', hint: '2013' }, { token: 'c_TWO', name: 'Fleabag (show)', hint: '2016' }] } };

  it('deterministic path: an ambiguous chip ends the run with one question and no scoring', async () => {
    const qloo = makeFakePort({ chips: ambiguous });
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ qloo })));
    const q = eventsOfType(events, 'ask_user');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ questionId: 'chip:a1', question: 'Which "Fleabag" did you mean?' });
    expect(q[0].options.map((o) => o.token)).toEqual(['c_ONE', 'c_TWO']);
    expect(qloo.calls.scoreDomain).toHaveLength(0);
    expect(types(events)).not.toContain('done');
    expect(types(events)).toContain('trace');
  });

  it('an answer swaps the chip token for scoring and maps explain tokens back to the client token', async () => {
    const qloo = makeFakePort({ chips: ambiguous });
    const req = exampleRequest({ includeLlm: false, answers: { 'chip:a1': 'c_TWO' } });
    const events = await collect((emit) => runPerkFit(req, emit, deps({ qloo })));
    expect(qloo.calls.segmentTokens[0]).toEqual(['c_TWO', 'a2', 'a3']);
    const sc = eventsOfType(events, 'scores')[0];
    const tokens = new Set(sc.scores.flatMap((s) => s.explain.map((e) => e.token)));
    expect([...tokens].sort()).toEqual(['a1', 'a2', 'a3']);
    expect(types(events)).toContain('done');
  });

  it('a chip that cannot be matched at all is an invalid_request on the segment', async () => {
    const qloo = makeFakePort({ chips: { a2: { status: 'no_match' } } });
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ qloo })));
    expect(eventsOfType(events, 'error')[0].error).toMatchObject({ code: 'invalid_request', field: 'segment.interests' });
  });

  it('Qloo being down while resolving a chip is qloo_unavailable', async () => {
    const qloo = makeFakePort({ chips: { a2: { status: 'unavailable', detail: 'upstream' } } });
    const events = await collect((emit) => runPerkFit(exampleRequest({ includeLlm: false }), emit, deps({ qloo })));
    expect(eventsOfType(events, 'error')[0].error.code).toBe('qloo_unavailable');
  });
});

describe('precache replay', () => {
  it('replays stored sentences, llm_alone and trace with zero LLM calls', async () => {
    // 1. A live run produces artifacts (this is what the precache build script does).
    let art: RunArtifacts | undefined;
    const live = new FakeLlm([ALONE, explainReply]);
    const req = exampleRequest();
    const liveEvents = await collect((emit) => runPerkFit(req, emit, deps({ llm: live, onArtifacts: (a) => (art = a) })));
    expect(art).toBeDefined();
    expect(art!.templates.length).toBeGreaterThan(0);

    // 2. Store them under the input hash, as extras of the Qloo precache.
    const extras = withRunExtras({}, art!.inputHash, art!);
    const precache = { fetchedAt: '2026-10-25T00:00:00.000Z', data: { extras } };

    // 3. Replay: no LLM client calls even if one is configured, no loop.
    const idle = new FakeLlm([]);
    const loop = mockLoopModel([]);
    const events = await collect((emit) => runPerkFit(req, emit, deps({ llm: idle, loopModel: loop, precache })));
    expect(idle.calls).toHaveLength(0);
    expect(loop.doGenerateCalls).toHaveLength(0);
    const meta = doneOf(events).meta;
    expect(meta).toMatchObject({ dataSource: 'cache', llm: 'cached', fetchedAt: '2026-10-25T00:00:00.000Z' });
    expect(meta.agentSteps).toBe(art!.trace.length);
    expect(eventsOfType(events, 'trace')[0].steps).toEqual(art!.trace);
    expect(eventsOfType(events, 'explanations')[0].items).toEqual(eventsOfType(liveEvents, 'explanations')[0].items);
    expect(eventsOfType(events, 'llm_alone')[0]).toMatchObject({ status: 'ok' });
  });

  it('stored templates are re-validated: an edit that moves a tier replaces that sentence with a fact sentence', async () => {
    let art: RunArtifacts | undefined;
    const req = exampleRequest();
    await collect((emit) => runPerkFit(req, emit, deps({ llm: new FakeLlm([ALONE, explainReply]), onArtifacts: (a) => (art = a) })));
    // Pretend one stored template carried a wrong tier.
    const tampered = { ...art!, templates: art!.templates.map((t, i) => (i === 0 ? { ...t, tier: t.tier === 'low' ? ('high' as const) : ('low' as const) } : t)) };
    const precache = { fetchedAt: 'x', data: { extras: withRunExtras({}, art!.inputHash, tampered) } };
    const events = await collect((emit) => runPerkFit(req, emit, deps({ llm: new FakeLlm([]), precache })));
    const items = eventsOfType(events, 'explanations')[0].items;
    expect(items[0].sentence).toMatch(/^[^{}]+: (high|mid|low) taste fit/);
    expect(items[1].sentence).toMatch(/percentile/);
  });

  it('a different input hash does not replay', async () => {
    const precache = { fetchedAt: 'x', data: { extras: withRunExtras({}, 'not-this-hash', { templates: [], llmAlone: null, trace: [] }) } };
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, precache })));
    expect(llm.calls).toHaveLength(2);
    expect(doneOf(events).meta.llm).toBe('ok');
  });

  it('a malformed extras blob is ignored, not trusted', async () => {
    const precache = { fetchedAt: 'x', data: { extras: { perkfit: { v: 2, runs: 'nope' } } } };
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, precache })));
    expect(doneOf(events).meta.llm).toBe('ok');
  });

  it('the hash used for extras ignores nothing the user can edit', () => {
    const req = exampleRequest();
    const a = hashInputs({ segment: req.segment, candidates: [], budget: 1, members: 1 });
    const b = hashInputs({ segment: req.segment, candidates: [], budget: 2, members: 1 });
    expect(a).not.toBe(b);
  });
});

describe('model-driven loop', () => {
  const resolveAll = toolStep(
    { name: 'resolve_chip', input: { token: 'a1' } },
    { name: 'resolve_chip', input: { token: 'a2' } },
    { name: 'resolve_chip', input: { token: 'a3' } },
  );
  const scoreAll = toolStep(
    { name: 'score_domain', input: { domain: 'place' } },
    { name: 'score_domain', input: { domain: 'tv_show' } },
    { name: 'score_domain', input: { domain: 'brand' } },
    { name: 'score_domain', input: { domain: 'book' } },
    { name: 'llm_alone', input: {} },
  );
  const optimize = toolStep({ name: 'optimize_bundle', input: {} });
  const finish = toolStep({ name: 'explain', input: {} }, { name: 'holdout_plan', input: {} });

  it('runs the planned sequence in 4 model calls and stops without a closing text step', async () => {
    const loopModel = mockLoopModel([resolveAll, scoreAll, optimize, finish]);
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, loopModel })));
    expect(loopModel.doGenerateCalls).toHaveLength(4);
    expect(llm.calls.map((c) => c.purpose)).toEqual(['llm_alone', 'explain']);
    const steps = eventsOfType(events, 'trace')[0].steps;
    expect(steps.some((s) => s.summary.startsWith('[fallback]'))).toBe(false);
    expect(steps.map((s) => s.step)).toEqual(steps.map((_, i) => i + 1));
    expect(doneOf(events).meta).toMatchObject({ llm: 'ok', agentSteps: steps.length });
    // 4 loop calls + 2 inner calls is within the budget of 8.
    expect(loopModel.doGenerateCalls.length + llm.calls.length).toBeLessThanOrEqual(8);
  });

  it('the model chooses to retry a perk with another name; the domain is scored again and the perk gets a score', async () => {
    const qloo = makeFakePort({ noData: { katz: 'no_match' }, resolveCandidate: 'resolved' });
    const retry = toolStep({ name: 'resolve_candidate', input: { candidateId: 'katz', query: "Katz's Deli" } });
    const loopModel = mockLoopModel([resolveAll, scoreAll, retry, optimize, finish]);
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ qloo, llm, loopModel })));
    expect(qloo.calls.resolveCandidate).toEqual([{ id: 'katz', name: "Katz's Deli" }]);
    expect(qloo.calls.scoreDomain.filter((d) => d === 'place')).toHaveLength(2);
    const katz = eventsOfType(events, 'scores')[0].scores.find((s) => s.candidateId === 'katz')!;
    expect(katz.status).toBe('ok');
    expect(doneOf(events).meta.noMatch).toBe(0);
  });

  it('allows at most 2 resolve_candidate retries per run', async () => {
    const qloo = makeFakePort({ noData: { katz: 'no_match', joes_pizza: 'no_match', levain: 'not_returned' }, resolveCandidate: 'no_match' });
    const retries = toolStep(
      { name: 'resolve_candidate', input: { candidateId: 'katz' } },
      { name: 'resolve_candidate', input: { candidateId: 'joes_pizza' } },
    );
    const third = toolStep({ name: 'resolve_candidate', input: { candidateId: 'levain' } });
    const loopModel = mockLoopModel([resolveAll, scoreAll, retries, third, optimize, finish]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ qloo, llm: new FakeLlm([ALONE, explainReply]), loopModel })));
    expect(qloo.calls.resolveCandidate).toHaveLength(2);
    const failed = eventsOfType(events, 'trace')[0].steps.filter((s) => s.tool === 'resolve_candidate' && !s.ok);
    expect(failed.map((s) => s.summary).join('|')).toMatch(/retry limit/);
  });

  it('ask_user stops the loop: one question, no scoring, no done', async () => {
    const qloo = makeFakePort({ chips: { a1: { status: 'ambiguous', options: [{ token: 'c_ONE', name: 'One' }] } } });
    const loopModel = mockLoopModel([resolveAll, toolStep({ name: 'ask_user', input: { token: 'a1' } }), scoreAll]);
    const llm = new FakeLlm([]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ qloo, llm, loopModel })));
    expect(eventsOfType(events, 'ask_user')).toHaveLength(1);
    expect(loopModel.doGenerateCalls).toHaveLength(2);
    expect(qloo.calls.scoreDomain).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
    expect(types(events)).not.toContain('done');
  });

  it('the model cannot score before chips are resolved (tool refuses, loop continues)', async () => {
    const loopModel = mockLoopModel([scoreAll, resolveAll, optimize, finish]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm: new FakeLlm([ALONE, explainReply]), loopModel })));
    const steps = eventsOfType(events, 'trace')[0].steps;
    expect(steps.some((s) => s.tool === 'score_domain' && !s.ok)).toBe(true);
    expect(doneOf(events)).toBeDefined();
  });

  it('a loop model that fails hands over to the deterministic orchestrator with the same result', async () => {
    const loopModel = new (mockLoopModel([]).constructor as new (o: object) => ReturnType<typeof mockLoopModel>)({
      doGenerate: async () => {
        throw new Error('provider down');
      },
    });
    const llm = new FakeLlm([ALONE, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, loopModel })));
    const steps = eventsOfType(events, 'trace')[0].steps;
    expect(steps.every((s) => s.summary.startsWith('[fallback]'))).toBe(true);
    expect(doneOf(events).meta.llm).toBe('ok');
    expect(eventsOfType(events, 'explanations')[0].items.every((i) => i.status === 'verified')).toBe(true);
  });

  it('a loop that never makes progress stops at the step limit and the fallback finishes', async () => {
    const spin = toolStep({ name: 'read_popularity', input: {} });
    const loopModel = mockLoopModel(Array.from({ length: 30 }, () => spin));
    const events = await collect((emit) =>
      runPerkFit(exampleRequest(), emit, deps({ llm: new FakeLlm([ALONE, explainReply]), loopModel, limits: { steps: 3 } })),
    );
    expect(loopModel.doGenerateCalls.length).toBeLessThanOrEqual(3);
    expect(doneOf(events)).toBeDefined();
  });

  it('the LLM call budget holds: loop steps leave room for llm_alone and explain with its retry', async () => {
    const spin = toolStep({ name: 'read_popularity', input: {} });
    const loopModel = mockLoopModel(Array.from({ length: 30 }, () => spin));
    const badFirst = (req: Parameters<typeof templateFromPrompt>[0]) => templateFromPrompt(req, (i) => (i.candidateId.length > 0 ? (i.text = '83') : undefined));
    const llm = new FakeLlm([ALONE, badFirst, explainReply]);
    const events = await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ llm, loopModel })));
    expect(loopModel.doGenerateCalls.length + llm.calls.length).toBeLessThanOrEqual(8);
    expect(llm.calls.map((c) => c.purpose)).toEqual(['llm_alone', 'explain', 'explain_retry']);
    expect(doneOf(events).meta.explanations.discarded).toBe(0);
  });

  it('a non-existent tool argument is rejected by the schema, not executed', async () => {
    const bad = toolStep({ name: 'score_domain', input: { domain: 'movie' } }, { name: 'resolve_candidate', input: { candidateId: 'katz', query: 'drop <table>' } });
    const qloo = makeFakePort({ noData: { katz: 'no_match' } });
    const loopModel = mockLoopModel([resolveAll, bad]);
    await collect((emit) => runPerkFit(exampleRequest(), emit, deps({ qloo, llm: new FakeLlm([ALONE, explainReply]), loopModel })));
    expect(qloo.calls.resolveCandidate).toHaveLength(0);
    // The loop's bad step did not score "movie"; the fallback scored the four real domains once each.
    expect([...qloo.calls.scoreDomain].sort()).toEqual(['book', 'brand', 'place', 'tv_show']);
  });
});

void textStep;
