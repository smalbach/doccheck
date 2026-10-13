import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../api/types';
import { applyEvent, EMPTY_PROGRESS, type RunTimeline } from './progressTimeline';
import { liveValidationRun, validationCaption } from './validationCaption';

let nextId = 1;
const v = (stage: string, status: ProgressEvent['status'], detail: Record<string, unknown> = {}, runId = 'run-1'): ProgressEvent =>
  ({ id: nextId++, shipmentId: 's', userId: 'u', runId, kind: 'validation', stage, status, at: '2026-10-13T10:00:00.000Z', detail }) as ProgressEvent;
const run = (...events: ProgressEvent[]): RunTimeline => events.reduce(applyEvent, EMPTY_PROGRESS).validation!;

describe('validation caption', () => {
  it('says what the run does now, in plain words', () => {
    expect(validationCaption(undefined)).toEqual({ key: 'progress.caption.starting' });
    expect(validationCaption(run(v('started', 'started')))).toEqual({ key: 'progress.caption.rulesStarting' });
    expect(validationCaption(run(v('rules', 'started', { documents: 3 }), v('rules', 'progress', { index: 1, total: 15 })))).toEqual({
      key: 'progress.caption.rules',
      vars: { count: 3, total: 15 },
    });
    expect(validationCaption(run(v('citations', 'started', { findings: 2 })))).toEqual({ key: 'progress.caption.citations' });
    expect(validationCaption(run(v('agent', 'started', { total: 2 })))).toEqual({ key: 'progress.caption.agent', vars: { count: 2 } });
    expect(validationCaption(run(v('agent', 'started', { total: 0 })))).toEqual({ key: 'progress.caption.agentNone' });
    expect(validationCaption(run(v('saved', 'started')))).toEqual({ key: 'progress.caption.saving' });
  });

  it('between two stages describes the next one, and says nothing once the run ended', () => {
    expect(validationCaption(run(v('rules', 'started', { documents: 3 }), v('rules', 'done', { total: 15 })))).toEqual({ key: 'progress.caption.citations' });
    expect(validationCaption(run(v('citations', 'started'), v('citations', 'skipped', { reason: 'no-index' })))).toEqual({ key: 'progress.caption.agentStarting' });
    expect(validationCaption(run(v('agent', 'skipped', { reason: 'disabled' })))).toEqual({ key: 'progress.caption.saving' });
    expect(validationCaption(run(v('saved', 'started'), v('saved', 'done')))).toBeUndefined();
  });
});

describe('live validation run', () => {
  it('shows a running run, and a saved one until the stored validation catches up', () => {
    const running = run(v('rules', 'started'));
    expect(liveValidationRun(running, 'old', true)).toBe(running);
    const saved = run(v('saved', 'started'), v('saved', 'done'));
    expect(liveValidationRun(saved, 'old', true)).toBe(saved);
    expect(liveValidationRun(saved, 'run-1', true)).toBeUndefined();
    // On page load the stored validation is not known yet: no flash of the live run.
    expect(liveValidationRun(saved, undefined, false)).toBeUndefined();
    expect(liveValidationRun(run(v('saved', 'failed', { error: 'boom' })), 'old', true)).toBeUndefined();
    expect(liveValidationRun(undefined, 'old', true)).toBeUndefined();
  });
});
