import { describe, expect, it } from 'vitest';
import type { ProgressEstimates, ProgressEvent } from '../api/types';
import { activityDoing, activityOutcome, applyActivityEvent, EMPTY_ACTIVITY, KEEP_FINISHED, queuePosition, remainingMs, runName, splitActivity, type ActivityState } from './activity';
import { activityAnnouncement } from './activityAnnouncement';

const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);
let nextId = 1;

/** An event with defaults; `t` is seconds after T0. */
function ev(partial: Partial<ProgressEvent> & Pick<ProgressEvent, 'kind' | 'stage' | 'status'>, t = 0): ProgressEvent {
  return { id: nextId++, shipmentId: 's-1', userId: 'u-1', runId: 'run-1', at: new Date(T0 + t * 1000).toISOString(), detail: {}, ...partial } as ProgressEvent;
}
const x = (runId: string, stage: string, status: ProgressEvent['status'], t = 0, more: Partial<ProgressEvent> = {}) =>
  ev({ kind: 'extraction', documentId: `doc-${runId}`, runId, stage, status, ...more } as ProgressEvent, t);
const v = (runId: string, stage: string, status: ProgressEvent['status'], t = 0, more: Partial<ProgressEvent> = {}) => ev({ kind: 'validation', runId, stage, status, ...more } as ProgressEvent, t);
const apply = (events: ProgressEvent[], state: ActivityState = EMPTY_ACTIVITY) => events.reduce(applyActivityEvent, state);
const at = (t: number) => T0 + t * 1000;

const est = (ms: number, samples = 5) => ({ ms, samples });
const estimates: ProgressEstimates = {
  model: 'ollama:qwen3.8',
  extraction: { reading: est(1000), classifying: est(100), normalizing: est(200), saved: est(100) },
  models: { 'ollama:qwen3.8': est(30_000), 'ollama:small': est(5000) },
  ocrPage: est(4000),
  validation: { rules: est(700), citations: est(500), agent: est(9000), saved: est(100) },
  agentQuestion: est(2000),
  computedAt: new Date(T0).toISOString(),
};

/** An extraction through the model call, started at t=10 s. */
const atModel = (model = 'ollama:qwen3.8') =>
  apply([
    x('a', 'queued', 'started', 0, { detail: { position: 1 } }),
    x('a', 'queued', 'done', 2, { durationMs: 2000 }),
    x('a', 'reading', 'started', 2),
    x('a', 'reading', 'done', 3, { durationMs: 1000 }),
    x('a', 'classifying', 'done', 3),
    x('a', 'extracting', 'started', 10, { detail: { model } }),
  ]);

describe('activity state', () => {
  it('keeps running runs and the latest finished ones, latest first', () => {
    const events: ProgressEvent[] = [x('live', 'queued', 'started', 0)];
    for (let i = 0; i < KEEP_FINISHED + 3; i++) events.push(v(`v${i}`, 'started', 'started', i), v(`v${i}`, 'saved', 'done', i + 1, { durationMs: 10 }));
    const state = apply(events);
    const { running, finished } = splitActivity(state);
    expect(running.map((r) => r.timeline.runId)).toEqual(['live']);
    expect(finished).toHaveLength(KEEP_FINISHED);
    expect(finished[0]?.timeline.runId).toBe(`v${KEEP_FINISHED + 2}`);
    expect(Object.keys(state.runs)).toHaveLength(KEEP_FINISHED + 1);
    // Idempotent: an event seen twice (a replay) changes nothing.
    expect(applyActivityEvent(state, events[0]!)).toBe(state);
  });

  it('names a run by its shipment reference and file', () => {
    const run = atModel().runs.a!;
    expect(runName(run, { shipments: { 's-1': { reference: 'CA-014', destination: 'CA' } }, documents: { 'doc-a': { fileName: 'invoice.pdf', status: 'EXTRACTING' } } }).full).toBe('CA-014 · invoice.pdf');
    expect(runName(run, { shipments: {}, documents: {} }).full).toBe('s-1');
  });

  it('says what a run is doing and since when', () => {
    expect(activityDoing(atModel().runs.a!.timeline)).toEqual({ key: 'activity.doing.extracting', since: new Date(at(10)).toISOString() });
    const agent = apply([v('v', 'started', 'started', 0), v('v', 'rules', 'done', 1), v('v', 'agent', 'started', 2, { detail: { total: 4 } }), v('v', 'agent', 'progress', 3, { detail: { index: 1, total: 4, question: 'q' } }), v('v', 'agent', 'progress', 5, { detail: { index: 1, total: 4, answer: { verdict: 'yes', confidence: 0.9 } } }), v('v', 'agent', 'progress', 6, { detail: { index: 2, total: 4, question: 'q2' } })]);
    expect(activityDoing(agent.runs.v!.timeline)).toMatchObject({ key: 'activity.doing.agentQuestion', vars: { index: 2, total: 4 } });
    const queued = apply([x('q', 'queued', 'started', 0, { detail: { position: 3 } })]);
    expect(activityDoing(queued.runs.q!.timeline, 2)).toMatchObject({ key: 'activity.doing.queuedAt', vars: { position: 2 } });
  });

  it('tells how a run ended, cancelled included', () => {
    const cancelled = apply([x('c', 'queued', 'started', 0), x('c', 'queued', 'failed', 1), x('c', 'saved', 'failed', 1, { detail: { error: 'Cancelled by the user', reason: 'cancelled' } })]);
    expect(activityOutcome(cancelled.runs.c!.timeline, 1000)).toEqual({ tone: 'cancelled', key: 'activity.outcome.cancelled' });
    const failed = apply([x('f', 'reading', 'started', 0), x('f', 'saved', 'failed', 1, { detail: { error: 'Ollama is not reachable' } })]);
    expect(activityOutcome(failed.runs.f!.timeline, 1000)).toMatchObject({ tone: 'failed', vars: { error: 'Ollama is not reachable' } });
    const validated = apply([v('v', 'started', 'started', 0), v('v', 'saved', 'done', 41, { detail: { findings: 3 } })]);
    expect(activityOutcome(validated.runs.v!.timeline, 41_000)).toEqual({ tone: 'ok', key: 'activity.outcome.validated', vars: { count: 3 }, durationMs: 41_000 });
  });

  it('moves a queued document up as the user\'s earlier ones leave the line', () => {
    const state = apply([
      x('a', 'queued', 'started', 0, { detail: { position: 1 } }),
      x('b', 'queued', 'started', 0, { detail: { position: 2 } }),
      x('c', 'queued', 'started', 0, { detail: { position: 3 } }),
      x('a', 'queued', 'done', 1),
    ]);
    const runs = Object.values(state.runs);
    expect(queuePosition(state.runs.c!, runs)).toBe(2);
    expect(queuePosition(state.runs.b!, runs)).toBe(1);
    expect(queuePosition(state.runs.a!, runs)).toBeUndefined();
  });
});

describe('time left', () => {
  it('adds the rest of the current stage to the stages ahead, per model', () => {
    const run = atModel().runs.a!.timeline;
    // 12 s into a 30 s model call: 18 s, then normalizing and saving.
    expect(remainingMs(run, estimates, at(22))).toBe(18_000 + 200 + 100);
    expect(remainingMs(atModel('ollama:small').runs.a!.timeline, estimates, at(12))).toBe(3000 + 300);
  });

  it('never goes negative, and gives up when a stage runs far longer than usual', () => {
    const run = atModel().runs.a!.timeline;
    expect(remainingMs(run, estimates, at(45))).toBe(300); // 35 s into a 30 s call: only what follows
    expect(remainingMs(run, estimates, at(10 + 43))).toBeUndefined(); // over 1.25 times as long (+5 s)
    expect(remainingMs(run, estimates, at(0))).toBe(30_000 + 300); // a clock behind the server
  });

  it('needs enough history for every stage ahead', () => {
    const run = atModel().runs.a!.timeline;
    expect(remainingMs(run, undefined, at(12))).toBeUndefined();
    expect(remainingMs(run, { ...estimates, models: { 'ollama:qwen3.8': est(30_000, 2) } }, at(12))).toBeUndefined();
    expect(remainingMs(run, { ...estimates, extraction: { ...estimates.extraction, normalizing: undefined } }, at(12))).toBeUndefined();
  });

  it('has no estimate while queued, and counts OCR per page', () => {
    const queued = apply([x('q', 'queued', 'started', 0)]);
    expect(remainingMs(queued.runs.q!.timeline, estimates, at(1))).toBeUndefined();
    const scan = apply([x('s', 'queued', 'started', 0), x('s', 'queued', 'done', 0), x('s', 'reading', 'started', 0), x('s', 'ocr', 'started', 0, { detail: { pages: 3 } }), x('s', 'ocr', 'progress', 1, { detail: { page: 1, pages: 3 } })]);
    // 3 pages at 4 s, 2 s in; then classifying, the model (default), normalizing, saving.
    expect(remainingMs(scan.runs.s!.timeline, estimates, at(2))).toBe(10_000 + 100 + 30_000 + 200 + 100);
  });

  it('counts the agent questions left, and skips the agent when it is off', () => {
    const base = [v('v', 'started', 'started', 0, { detail: { agent: true } }), v('v', 'rules', 'started', 0), v('v', 'rules', 'done', 1), v('v', 'citations', 'done', 1)];
    const agent = apply([...base, v('v', 'agent', 'started', 1, { detail: { total: 4 } }), v('v', 'agent', 'progress', 2, { detail: { index: 1, total: 4, answer: { verdict: 'no', confidence: 0.8 } } })]);
    expect(remainingMs(agent.runs.v!.timeline, estimates, at(3))).toBe(3 * 2000 + 100);
    const off = apply([v('w', 'started', 'started', 0, { detail: { agent: false } }), v('w', 'rules', 'started', 0)]);
    expect(remainingMs(off.runs.w!.timeline, estimates, at(0))).toBe(700 + 500 + 100);
  });
});

describe('activity announcements', () => {
  const names = { shipments: { 's-1': { reference: 'US-007', destination: 'US' } }, documents: { 'doc-a': { fileName: 'invoice.pdf', status: 'EXTRACTED' } } };
  it('speaks when runs start and end, not on every step', () => {
    const start = x('a', 'queued', 'started', 0);
    let state = apply([start]);
    expect(activityAnnouncement(start, state, names)).toEqual({ key: 'activity.announce.running', vars: { count: 1 } });
    const step = x('a', 'reading', 'started', 1);
    state = applyActivityEvent(state, step);
    expect(activityAnnouncement(step, state, names)).toBeNull();
    const retry = x('a', 'saved', 'failed', 2, { detail: { willRetry: true } });
    expect(activityAnnouncement(retry, applyActivityEvent(state, retry), names)).toBeNull();
    const done = x('a', 'saved', 'done', 3);
    expect(activityAnnouncement(done, applyActivityEvent(state, done), names)).toEqual({ key: 'activity.announce.extracted', vars: { name: 'US-007 · invoice.pdf' } });
    const cancelled = x('a', 'saved', 'failed', 3, { detail: { reason: 'cancelled', error: 'Cancelled by the user' } });
    expect(activityAnnouncement(cancelled, applyActivityEvent(state, cancelled), names)?.key).toBe('activity.announce.cancelled');
  });
});
