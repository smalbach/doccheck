import { describe, expect, it } from 'vitest';
import type { ProgressEvent } from '../api/types';
import { applyOutput, lastCompletedValue, textBeingWritten, type LiveOutput } from './liveOutput';
import { findValue, groupLines } from './pdfTextLines';
import { applyEvent, EMPTY_PROGRESS, type ProgressState } from './progressTimeline';

let nextId = 1;
const DOC = 'd-1';

/** A stored extraction event. */
const x = (stage: string, status: ProgressEvent['status'], runId = 'run-1'): ProgressEvent =>
  ({ id: nextId++, shipmentId: 's-1', userId: 'u-1', documentId: DOC, runId, kind: 'extraction', stage, status, at: '2026-10-13T10:00:00.000Z', detail: {} }) as ProgressEvent;

/** An ephemeral delta of the model's answer. */
const delta = (text: string, offset: number, more: Record<string, unknown> = {}, runId = 'run-1'): ProgressEvent =>
  ({
    id: 0,
    ephemeral: true,
    shipmentId: 's-1',
    userId: null,
    documentId: DOC,
    runId,
    kind: 'extraction',
    stage: 'extracting',
    status: 'progress',
    at: '2026-10-13T10:00:01.000Z',
    detail: { delta: text, offset, tokens: offset + text.length, ...more },
  }) as ProgressEvent;

const outputOf = (events: ProgressEvent[]) => events.reduce<LiveOutput | undefined>(applyOutput, undefined);

describe('live output', () => {
  it('joins deltas, and applying one twice changes nothing', () => {
    const a = delta('{"inv', 0);
    const b = delta('oice": "A', 5, { tokensPerSecond: 31.5 });
    const out = outputOf([a, b, b, a]);
    expect(out).toEqual({ runId: 'run-1', text: '{"invoice": "A', start: 0, tokens: 14, tokensPerSecond: 31.5, replay: false });
  });

  it('keeps only the new part of an overlapping delta', () => {
    expect(outputOf([delta('{"a"', 0), delta('a": 1', 2)])?.text).toBe('{"a": 1');
  });

  it('starts from the delta after a gap or when joining late, and marks where it starts', () => {
    expect(outputOf([delta('lue"}', 40)])).toMatchObject({ text: 'lue"}', start: 40 });
    expect(outputOf([delta('{"a', 0), delta('xyz', 10)])).toMatchObject({ text: 'xyz', start: 10 });
  });

  it('starts over on a retry or a new run', () => {
    expect(outputOf([delta('{"bad"', 0), delta('{"go', 0, { restart: true })])?.text).toBe('{"go');
    expect(outputOf([delta('{"old"', 0), delta('{"new', 0, {}, 'run-2')])).toMatchObject({ runId: 'run-2', text: '{"new' });
  });

  it('remembers a replay', () => {
    expect(outputOf([delta('{', 0, { replay: true }), delta('}', 1)])?.replay).toBe(true);
  });

  it('lives in the progress state until the run ends, without touching the steps', () => {
    const apply = (events: ProgressEvent[], state: ProgressState = EMPTY_PROGRESS) => events.reduce(applyEvent, state);
    const writing = apply([x('extracting', 'started'), delta('{"a": "1"', 0), delta(', "b"', 9)]);
    expect(writing.outputs?.[DOC]?.text).toBe('{"a": "1", "b"');
    expect(writing.documents[DOC]?.steps.extracting?.detail).toEqual({});
    expect(writing.documents[DOC]?.lastId).toBeGreaterThan(0);
    expect(textBeingWritten(writing.documents[DOC], writing.outputs?.[DOC])).toBe('{"a": "1", "b"');

    const modelDone = apply([x('extracting', 'done')], writing);
    expect(modelDone.outputs?.[DOC]).toBeDefined();
    expect(textBeingWritten(modelDone.documents[DOC], modelDone.outputs?.[DOC])).toBeUndefined();
    expect(apply([x('saved', 'done')], modelDone).outputs?.[DOC]).toBeUndefined();
    // A new model call (a re-extraction) starts from nothing.
    expect(apply([x('extracting', 'started', 'run-2')], writing).outputs?.[DOC]).toBeUndefined();
  });
});

describe('last completed value', () => {
  it('finds the last string value fully written, not a key', () => {
    expect(lastCompletedValue('{"invoiceNumber": "INV-7", "total": "1,2')).toBe('INV-7');
    expect(lastCompletedValue('{"invoiceNumber": "INV-7", "total": "1,200.00"')).toBe('INV-7');
    expect(lastCompletedValue('{"invoiceNumber": "INV-7", "total": "1,200.00"}')).toBe('1,200.00');
    expect(lastCompletedValue('{"lines": [{"sku": "A \\"1\\""},\n  "x"]')).toBe('x');
    expect(lastCompletedValue('{"a": "b",')).toBe('b');
    expect(lastCompletedValue('{"seller":')).toBeUndefined();
    expect(lastCompletedValue('')).toBeUndefined();
  });
});

describe('PDF lines', () => {
  // Page 800 pt high; pdf.js baselines are from the bottom.
  const runs = [
    { str: 'COMMERCIAL INVOICE', x: 50, y: 760, width: 200, height: 14 },
    { str: 'Invoice No.', x: 50, y: 700, width: 60, height: 10 },
    { str: 'INV-2026-0042', x: 300, y: 701, width: 90, height: 10 },
    { str: 'Total', x: 50, y: 600, width: 30, height: 10 },
    { str: 'USD 1,200.00', x: 300, y: 600, width: 80, height: 10 },
    { str: ' ', x: 10, y: 10, width: 1, height: 10 },
  ];
  const lines = groupLines(runs, 1, 800);

  it('groups runs on the same baseline into lines, top to bottom, with top-left boxes', () => {
    expect(lines.map((l) => l.text)).toEqual(['commercial invoice', 'invoice no. inv-2026-0042', 'total usd 1,200.00']);
    expect(lines[0]?.bbox).toEqual([50, 26, 250, 40]);
    expect(lines[1]?.runs.map((r) => [r.start, r.end])).toEqual([
      [0, 11],
      [12, 25],
    ]);
  });

  it('points at the runs holding the value, searching on from the previous match', () => {
    expect(findValue(lines, 'INV-2026-0042')).toEqual({ index: 1, page: 1, bbox: [300, 89, 390, 99] });
    // Over two runs: both.
    expect(findValue(lines, 'No.  INV-2026-0042')).toEqual({ index: 1, page: 1, bbox: [50, 89, 390, 100] });
    // From line 2 on, wrapping to the top.
    expect(findValue(lines, 'INVOICE', 2)?.index).toBe(0);
    expect(findValue(lines, 'INVOICE', 1)?.index).toBe(1);
  });

  it('matches whole words only, and skips values too short or not printed', () => {
    expect(findValue(groupLines([{ str: 'TOTAL 182 PKGS', x: 0, y: 0, width: 50, height: 7 }], 1, 100), 'KGS')).toBeUndefined();
    expect(findValue(lines, '1,200')?.index).toBe(2);
    expect(findValue(lines, '1')).toBeUndefined();
    expect(findValue(lines, '--')).toBeUndefined();
    expect(findValue(lines, 'EUR 5')).toBeUndefined();
  });
});
