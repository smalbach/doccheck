import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../api/types';
import { progressAnnouncement } from './progressAnnouncement';
import { currentStep, stepsOf } from './progressSteps';
import { applyEvent, EMPTY_PROGRESS, runDuration, type ProgressState } from './progressTimeline';

const SHIPMENT = 's-1';
const DOC = 'd-1';
let nextId = 1;

/** An event with defaults; `t` is seconds after a fixed start. */
function ev(partial: Partial<ProgressEvent> & Pick<ProgressEvent, 'kind' | 'stage' | 'status'>, t = 0): ProgressEvent {
  return {
    id: nextId++,
    shipmentId: SHIPMENT,
    userId: 'u-1',
    runId: 'run-1',
    at: new Date(Date.UTC(2026, 9, 13, 10, 0, t)).toISOString(),
    detail: {},
    ...(partial.kind === 'extraction' ? { documentId: DOC } : {}),
    ...partial,
  } as ProgressEvent;
}

const x = (stage: string, status: ProgressEvent['status'], t = 0, more: Partial<ProgressEvent> = {}) => ev({ kind: 'extraction', stage, status, ...more } as ProgressEvent, t);
const v = (stage: string, status: ProgressEvent['status'], t = 0, more: Partial<ProgressEvent> = {}) => ev({ kind: 'validation', stage, status, ...more } as ProgressEvent, t);
const apply = (events: ProgressEvent[], state: ProgressState = EMPTY_PROGRESS) => events.reduce(applyEvent, state);

describe('progress timeline', () => {
  it('follows an extraction stage by stage, OCR pages included', () => {
    const state = apply([
      x('queued', 'started', 0, { detail: { position: 2 } }),
      x('queued', 'done', 3, { durationMs: 3000 }),
      x('reading', 'started', 3),
      x('ocr', 'started', 3, { detail: { pages: 2 } }),
      x('ocr', 'progress', 4, { detail: { page: 2, pages: 2 } }),
    ]);
    const run = state.documents[DOC]!;
    expect(run.state).toBe('running');
    const steps = stepsOf(run);
    expect(steps.map((s) => [s.stage, s.display])).toEqual([
      ['queued', 'done'],
      ['reading', 'running'],
      ['ocr', 'running'],
      ['classifying', 'pending'],
      ['extracting', 'pending'],
      ['normalizing', 'pending'],
      ['saved', 'pending'],
    ]);
    expect(currentStep(steps)?.note).toEqual({ key: 'progress.notes.page', vars: { page: 2, pages: 2 } });
  });

  it('ends with saved, keeps durations and leaves out OCR when it was not needed', () => {
    const state = apply([
      x('queued', 'started', 0),
      x('reading', 'started', 1),
      x('reading', 'done', 2, { durationMs: 900 }),
      x('classifying', 'skipped', 2, { detail: { reason: 'type-given', documentType: 'PACKING_LIST' } }),
      x('extracting', 'started', 2, { detail: { model: 'ollama:qwen3.8' } }),
      x('extracting', 'done', 30, { durationMs: 28_000, detail: { cached: false } }),
      x('saved', 'started', 30),
      x('saved', 'done', 31, { durationMs: 40 }),
    ]);
    const run = state.documents[DOC]!;
    expect(run.state).toBe('done');
    expect(runDuration(run)).toBe(31_000);
    const steps = stepsOf(run);
    expect(steps.map((s) => s.stage)).toEqual(['queued', 'reading', 'classifying', 'extracting', 'saved']);
    expect(steps.find((s) => s.stage === 'classifying')?.note?.key).toBe('progress.notes.typeGiven');
    expect(steps.find((s) => s.stage === 'extracting')).toMatchObject({ display: 'done', durationMs: 28_000, note: { key: 'progress.notes.model', vars: { model: 'ollama:qwen3.8' } } });
  });

  it('shows a failure with its error, and a retry starts the steps over', () => {
    const failed = apply([
      x('reading', 'started', 0),
      x('reading', 'done', 1, { durationMs: 1000 }),
      x('extracting', 'started', 1),
      x('extracting', 'failed', 5, { durationMs: 4000, detail: { error: 'Ollama is not reachable' } }),
      x('saved', 'failed', 5, { durationMs: 0, detail: { error: 'Ollama is not reachable', willRetry: true } }),
    ]);
    expect(failed.documents[DOC]!.state).toBe('running');
    expect(stepsOf(failed.documents[DOC]!).find((s) => s.stage === 'extracting')).toMatchObject({ display: 'failed', error: 'Ollama is not reachable' });

    const retried = apply([x('queued', 'started', 6, { detail: { reason: 'retry' } }), x('reading', 'started', 11)], failed);
    expect(Object.keys(retried.documents[DOC]!.steps)).toEqual(['queued', 'reading']);

    const gaveUp = apply([x('saved', 'failed', 20, { detail: { error: 'Ollama is not reachable' } })], retried);
    expect(gaveUp.documents[DOC]!.state).toBe('failed');
  });

  it('ignores events applied twice and keeps only the latest run of a document', () => {
    const events = [x('queued', 'started', 0), x('reading', 'started', 1), x('reading', 'done', 2, { durationMs: 1000 })];
    const once = apply(events);
    expect(apply(events, once)).toEqual(once);
    const newer = apply([x('queued', 'started', 9, { runId: 'run-2' })], once);
    expect(newer.documents[DOC]!.runId).toBe('run-2');
    // A late event of the older run does not bring it back.
    const late = applyEvent(newer, { ...events[2]!, id: 1 });
    expect(late.documents[DOC]!.runId).toBe('run-2');
  });

  it('counts rules and numbers the agent questions of a validation', () => {
    const state = apply([
      v('started', 'started', 0, { detail: { agent: true, destination: 'CA' } }),
      v('rules', 'started', 0),
      v('rules', 'progress', 0, { detail: { rule: 'X1', index: 1, total: 2 } }),
      v('rules', 'progress', 0, { detail: { rule: 'X2', index: 2, total: 2 } }),
      v('rules', 'done', 1, { durationMs: 5, detail: { ran: 2, skipped: 0, total: 2, findings: 1 } }),
      v('citations', 'started', 1),
      v('citations', 'done', 1, { durationMs: 300, detail: { citations: 1 } }),
      v('agent', 'started', 1, { detail: { model: 'ollama:qwen3.8', total: 2 } }),
      v('agent', 'progress', 1, { detail: { index: 1, total: 2, ruleId: 'X1', question: 'Same consignee written differently?' } }),
      v('agent', 'progress', 9, { detail: { index: 1, total: 2, ruleId: 'X1', question: 'Same consignee written differently?', answer: { verdict: 'yes', confidence: 0.9 } } }),
      v('agent', 'progress', 9, { detail: { index: 2, total: 2, ruleId: 'A1', question: 'BL cargo description consistent with the invoice?' } }),
    ]);
    const run = state.validation!;
    const steps = stepsOf(run);
    expect(steps.map((s) => [s.stage, s.display, s.note?.key, s.note?.vars])).toEqual([
      ['rules', 'done', 'progress.notes.count', { count: 2, total: 2 }],
      ['citations', 'done', 'progress.notes.citations', { count: 1 }],
      ['agent', 'running', 'progress.notes.question', { index: 2, total: 2 }],
      ['saved', 'pending', undefined, undefined],
    ]);
    expect(run.questions.map((q) => [q.index, q.answer?.verdict])).toEqual([
      [1, 'yes'],
      [2, undefined],
    ]);
    const done = apply([v('agent', 'done', 20, { durationMs: 19_000, detail: { decisions: 2 } }), v('saved', 'started', 20), v('saved', 'done', 41, { detail: { validationId: 'run-1' } })], state);
    expect(done.validation!.state).toBe('done');
    expect(runDuration(done.validation!)).toBe(41_000);
  });

  it('announces milestones only', () => {
    expect(progressAnnouncement(x('extracting', 'started'), 'invoice.pdf', 0)).toEqual({ key: 'progress.announce.extracting', vars: { file: 'invoice.pdf' } });
    expect(progressAnnouncement(x('ocr', 'progress', 0, { detail: { page: 1, pages: 2 } }), 'invoice.pdf', 0)).toBeNull();
    expect(progressAnnouncement(x('saved', 'failed', 0, { detail: { willRetry: true } }), 'invoice.pdf', 0)).toBeNull();
    expect(progressAnnouncement(v('rules', 'progress'), undefined, 0)).toBeNull();
    expect(progressAnnouncement(v('agent', 'progress'), undefined, 0)).toBeNull();
    expect(progressAnnouncement(v('agent', 'started', 0, { detail: { total: 0 } }), undefined, 0)).toBeNull();
    expect(progressAnnouncement(v('saved', 'done'), undefined, 41_000)).toEqual({ key: 'progress.announce.validationDone', durationMs: 41_000 });
  });
});
