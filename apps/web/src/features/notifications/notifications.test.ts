import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressEvent } from '../../api/types';
import type { MessageKey, MessageVars } from '../../i18n/keys';
import { en } from '../../i18n/messages/en';
import { translate } from '../../i18n/translate';
import { backgroundNotifyAllowed, requestNotifyPermission, showBrowserNotification, writeBackgroundNotify } from './browserNotifications';
import { createBatcher } from './createBatcher';
import { finishedRun, type FinishedRun } from './finishedRun';
import { groupRuns, mergeGroup } from './groupRuns';
import { notificationText } from './notificationText';
import { notifyTargets } from './notifyTargets';
import { countRunning, pageTitle, STALE_RUN_MS, trackRun } from './runningRuns';
import { takeFinished } from './takeFinished';

const S1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const S2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const AT = Date.UTC(2026, 9, 13, 10, 0, 0);
let nextId = 1;

/** An event with defaults; `t` is seconds after a fixed start. */
function ev(partial: Partial<ProgressEvent> & Pick<ProgressEvent, 'kind' | 'stage' | 'status'>, t = 0): ProgressEvent {
  return { id: nextId++, shipmentId: S1, userId: 'u-1', runId: 'run-1', at: new Date(AT + t * 1000).toISOString(), detail: {}, ...partial } as ProgressEvent;
}
const saved = (status: 'done' | 'failed', more: Partial<ProgressEvent> = {}) => ev({ kind: 'extraction', stage: 'saved', status, documentId: 'd-1', ...more } as ProgressEvent);
const validated = (more: Partial<ProgressEvent> = {}) => ev({ kind: 'validation', stage: 'saved', status: 'done', runId: 'v-1', ...more } as ProgressEvent);
const run = (outcome: FinishedRun['outcome'], runId: string, more: Partial<FinishedRun> = {}): FinishedRun => ({ outcome, shipmentId: S1, runId, ...more });
const t = (key: MessageKey, vars?: MessageVars) => translate(en, 'en', key, vars);

describe('finished runs', () => {
  it('ends a run on saved only, not on a failure the queue retries', () => {
    expect(finishedRun(ev({ kind: 'extraction', stage: 'extracting', status: 'done' }))).toBeNull();
    expect(finishedRun(saved('done'))).toMatchObject({ outcome: 'extracted', documentId: 'd-1', runId: 'run-1' });
    expect(finishedRun(saved('failed', { detail: { error: 'Model timed out', willRetry: true } }))).toBeNull();
    expect(finishedRun(saved('failed', { detail: { error: 'Model timed out' } }))).toMatchObject({ outcome: 'extractionFailed', error: 'Model timed out' });
    expect(finishedRun(validated({ detail: { findings: 3 } }))).toMatchObject({ outcome: 'validated', findings: 3 });
    expect(finishedRun(ev({ kind: 'validation', stage: 'saved', status: 'failed', detail: { error: 'boom' } }))).toMatchObject({ outcome: 'validationFailed', error: 'boom' });
  });

  it('tells live events only, each run once', () => {
    const seen = new Set<string>();
    const e = saved('done');
    expect(takeFinished(e, false, seen)).toBeNull(); // replayed from the backlog
    expect(takeFinished(e, true, seen)).not.toBeNull();
    expect(takeFinished({ ...e, id: e.id + 100 }, true, seen)).toBeNull(); // same run delivered again
    expect(takeFinished(ev({ kind: 'extraction', stage: 'reading', status: 'started' }), true, seen)).toBeNull();
  });
});

describe('grouping', () => {
  it('groups extractions of a shipment, keeps validations apart', () => {
    const groups = groupRuns([
      run('extracted', 'r1'),
      run('extracted', 'r2'),
      run('extracted', 'r3', { shipmentId: S2 }),
      run('extracted', 'r2'),
      run('extractionFailed', 'r4'),
      run('validated', 'v1'),
      run('validated', 'v2'),
    ]);
    expect(groups.map((g) => [g.shipmentId, g.outcome, g.runs.map((r) => r.runId)])).toEqual([
      [S1, 'extracted', ['r1', 'r2']],
      [S2, 'extracted', ['r3']],
      [S1, 'extractionFailed', ['r4']],
      [S1, 'validated', ['v1']],
      [S1, 'validated', ['v2']],
    ]);
  });

  it('merges a late run into the group told just before', () => {
    const [first] = groupRuns([run('extracted', 'r1'), run('extracted', 'r2')]);
    const [late] = groupRuns([run('extracted', 'r3'), run('extracted', 'r2')]);
    expect(mergeGroup(first, late!).runs.map((r) => r.runId)).toEqual(['r1', 'r2', 'r3']);
    const [other] = groupRuns([run('extracted', 'r9', { shipmentId: S2 })]);
    expect(mergeGroup(first, other!)).toBe(other);
    expect(mergeGroup(undefined, late!)).toBe(late);
  });

  it('batches a burst, flushing after a quiet time or at the latest after the max wait', () => {
    vi.useFakeTimers();
    const flushed: number[][] = [];
    const b = createBatcher<number>((items) => flushed.push(items), { quietMs: 1000, maxMs: 2500 });
    b.add(1);
    vi.advanceTimersByTime(800);
    b.add(2);
    vi.advanceTimersByTime(800);
    b.add(3);
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(1000); // 2.6 s after the first: the max wait has passed
    expect(flushed).toEqual([[1, 2, 3]]);
    b.add(4);
    vi.advanceTimersByTime(1000);
    expect(flushed).toEqual([[1, 2, 3], [4]]);
    b.add(5);
    b.cancel();
    vi.advanceTimersByTime(5000);
    expect(flushed).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe('should notify', () => {
  const group = { shipmentId: S1 };
  it('toasts unless the shipment page is open; notifies the browser only in the background, opted in', () => {
    expect(notifyTargets(group, { visible: true, backgroundAllowed: true })).toEqual({ toast: true, browser: false });
    expect(notifyTargets(group, { watchingShipmentId: S1, visible: true, backgroundAllowed: true })).toEqual({ toast: false, browser: false });
    expect(notifyTargets(group, { watchingShipmentId: S2, visible: true, backgroundAllowed: false })).toEqual({ toast: true, browser: false });
    expect(notifyTargets(group, { watchingShipmentId: S1, visible: false, backgroundAllowed: true })).toEqual({ toast: false, browser: true });
    expect(notifyTargets(group, { visible: false, backgroundAllowed: false })).toEqual({ toast: true, browser: false });
  });
});

describe('texts', () => {
  const info = { reference: 'CA-014', fileNames: { 'd-1': 'invoice.pdf' } };
  it('names the file of one document, counts a burst', () => {
    const [one] = groupRuns([run('extracted', 'r1', { documentId: 'd-1' })]);
    expect(notificationText(one!, info, t)).toEqual({ shipment: 'CA-014', title: 'CA-014: invoice.pdf extracted' });
    const [three] = groupRuns(['r1', 'r2', 'r3'].map((id) => run('extracted', id)));
    expect(notificationText(three!, info, t).title).toBe('3 documents of CA-014 extracted');
    const [failed] = groupRuns([run('extractionFailed', 'r1', { documentId: 'd-1', error: 'Model timed out' })]);
    expect(notificationText(failed!, info, t)).toMatchObject({ title: 'CA-014: invoice.pdf could not be extracted', body: 'Model timed out' });
  });

  it('summarizes a validation, falls back without a reference', () => {
    const [v] = groupRuns([run('validated', 'v1', { findings: 3 })]);
    expect(notificationText(v!, { reference: 'US-007', fileNames: {}, critical: 1 }, t).title).toBe('US-007 validated: 3 findings (1 critical)');
    expect(notificationText(v!, { reference: 'US-007', fileNames: {} }, t).title).toBe('US-007 validated: 3 findings');
    const [clean] = groupRuns([run('validated', 'v2', { findings: 0 })]);
    expect(notificationText(clean!, { fileNames: {} }, t).title).toBe('Shipment aaaaaaaa validated: no findings');
  });
});

describe('tab title', () => {
  it('counts runs under way, ignoring stale ones', () => {
    let r = trackRun(new Map(), ev({ kind: 'extraction', stage: 'queued', status: 'started', runId: 'a' }));
    r = trackRun(r, ev({ kind: 'extraction', stage: 'queued', status: 'started', runId: 'b' }));
    r = trackRun(r, ev({ kind: 'validation', stage: 'started', status: 'started', runId: 'c' }));
    expect(countRunning(r, AT)).toBe(3);
    r = trackRun(r, saved('failed', { runId: 'a', detail: { willRetry: true } }));
    expect(countRunning(r, AT)).toBe(3); // retried: still running
    r = trackRun(r, saved('done', { runId: 'a' }));
    r = trackRun(r, validated({ runId: 'c' }));
    expect(countRunning(r, AT)).toBe(1);
    expect(countRunning(r, AT + STALE_RUN_MS + 1)).toBe(0);
  });

  it('shows the count, then a check after a run ended in the background', () => {
    expect(pageTitle('DocCheck', 2, true)).toBe('(2) DocCheck');
    expect(pageTitle('DocCheck', 0, true)).toBe('✓ DocCheck');
    expect(pageTitle('DocCheck', 0, false)).toBe('DocCheck');
  });
});

describe('browser notifications', () => {
  class FakeNotification {
    static permission: NotificationPermission = 'default';
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'granted';
      return FakeNotification.permission;
    });
    static shown: FakeNotification[] = [];
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(
      public title: string,
      public options: NotificationOptions,
    ) {
      FakeNotification.shown.push(this);
    }
  }
  const store = new Map<string, string>();

  beforeEach(() => {
    FakeNotification.permission = 'default';
    FakeNotification.shown = [];
    store.clear();
    vi.stubGlobal('Notification', FakeNotification);
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }, focus: vi.fn() });
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('needs both the opt-in and the permission', async () => {
    expect(backgroundNotifyAllowed()).toBe(false);
    writeBackgroundNotify(true);
    expect(backgroundNotifyAllowed()).toBe(false);
    expect(await requestNotifyPermission()).toBe('granted');
    expect(backgroundNotifyAllowed()).toBe(true);
    writeBackgroundNotify(false);
    expect(backgroundNotifyAllowed()).toBe(false);
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(() => writeBackgroundNotify(true)).not.toThrow();
    expect(backgroundNotifyAllowed()).toBe(false);
  });

  it('shows a notification whose click focuses the tab and opens the shipment', () => {
    const open = vi.fn();
    showBrowserNotification('CA-014: invoice.pdf extracted', { tag: `${S1}:extracted`, onClick: open });
    const [n] = FakeNotification.shown;
    expect(n?.title).toBe('CA-014: invoice.pdf extracted');
    expect(n?.options).toMatchObject({ tag: `${S1}:extracted`, lang: 'en' });
    n?.onclick?.();
    expect(window.focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
    expect(n?.close).toHaveBeenCalled();
  });

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(await requestNotifyPermission()).toBe('unsupported');
    expect(() => showBrowserNotification('x', { tag: 'x', onClick: () => undefined })).not.toThrow();
  });
});
