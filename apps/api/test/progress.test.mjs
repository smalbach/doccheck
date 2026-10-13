// Progress event helpers (built API: npm run build first): NOTIFY payloads, SSE framing, resume
// position, demo pacing, and how a run closes its stages on an error.
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { parseNotification, resumeAfter, sseEvent, sseNamed } = require('../dist/progress/sse.js');
const { pacingFor, demoPacing } = require('../dist/progress/demo-pacing.js');
const { ProgressRun } = require('../dist/progress/progress-run.js');

const event = {
  id: 42,
  shipmentId: '6f1c1c49-6e8f-4d2e-9f0e-2f4b8a1c0d11',
  userId: '0b8f5f8e-3c55-4c3a-9a43-1d6f7a2c9e10',
  documentId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  runId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  kind: 'extraction',
  stage: 'ocr',
  status: 'progress',
  at: '2026-10-13T10:00:00.000Z',
  detail: { page: 1, pages: 3 },
};

describe('progress helpers', () => {
  it('reads a NOTIFY payload: a whole event, an id to read back, or nothing', () => {
    assert.deepEqual(parseNotification(JSON.stringify(event)), event);
    assert.deepEqual(parseNotification('{"id":42}'), { id: 42 });
    assert.equal(parseNotification('{"id":"42"}'), null);
    assert.equal(parseNotification('not json'), null);
    // An event that does not parse is read back from the table by its id.
    assert.deepEqual(parseNotification(JSON.stringify({ ...event, stage: 'agent' })), { id: 42 });
  });

  it('frames SSE messages with the event id', () => {
    assert.equal(sseEvent(event), `id: 42\ndata: ${JSON.stringify(event)}\n\n`);
    assert.equal(sseNamed('ready', { lastId: 42 }), 'event: ready\ndata: {"lastId":42}\n\n');
  });

  it('resumes after Last-Event-ID first, then ?after=', () => {
    assert.equal(resumeAfter('17', '3'), 17);
    assert.equal(resumeAfter(undefined, '3'), 3);
    assert.equal(resumeAfter(['8'], undefined), 8);
    assert.equal(resumeAfter('nope', 'x'), undefined);
    assert.equal(resumeAfter(undefined, ['3']), undefined);
    assert.equal(resumeAfter(undefined, undefined), undefined);
  });

  it('paces the read-only demo only, and only where the model would have taken time', () => {
    assert.equal(demoPacing({ DEMO_READONLY: 'true' }), true);
    assert.equal(demoPacing({ DEMO_READONLY: 'true', DEMO_PACING: 'false' }), false);
    assert.equal(demoPacing({}), false);
    assert.ok(pacingFor('extraction', 'extracting', 'done', false) > 0);
    assert.equal(pacingFor('extraction', 'extracting', 'started', false), 0);
    assert.equal(pacingFor('extraction', 'saved', 'done', false), 0);
    assert.ok(pacingFor('validation', 'agent', 'progress', true) > 0);
    assert.equal(pacingFor('validation', 'agent', 'progress', false), 0);
    assert.equal(pacingFor('validation', 'agent', 'done', false), 0);
  });

  it('fails the open stages, then saved, when a run fails between or inside stages', async () => {
    const published = [];
    const run = new ProgressRun({ kind: 'extraction', shipmentId: event.shipmentId, documentId: event.documentId, runId: event.runId }, async (e) => published.push(e));
    await run.report({ stage: 'reading', status: 'started' });
    await run.report({ stage: 'reading', status: 'done', durationMs: 5 });
    await run.report({ stage: 'extracting', status: 'started', detail: { model: 'ollama:test' } });
    await run.fail(new Error('Ollama is not reachable'), 'saved', { willRetry: true });
    assert.deepEqual(published.map((e) => `${e.stage}:${e.status}`), ['reading:started', 'reading:done', 'extracting:started', 'extracting:failed', 'saved:failed']);
    assert.deepEqual(published.at(-1).detail, { willRetry: true, error: 'Ollama is not reachable' });
    assert.ok(published.every((e) => e.runId === event.runId && e.documentId === event.documentId && e.kind === 'extraction' && typeof e.at === 'string'));

    const validation = [];
    const v = new ProgressRun({ kind: 'validation', shipmentId: event.shipmentId, runId: event.runId }, async (e) => validation.push(e));
    await v.report({ stage: 'started', status: 'started' });
    await v.fail('database down', 'saved');
    assert.deepEqual(validation.map((e) => `${e.stage}:${e.status}`), ['started:started', 'saved:failed']);
  });
});

describe('progress estimates', () => {
  const { buildEstimates } = require('../dist/progress/progress-estimates.service.js');
  const row = (stage, ms, samples, more = {}) => ({ kind: 'extraction', stage, model: '', cached: false, ms, samples, ...more });

  it('uses model calls that ran the model, falling back on llm_calls, and merges stage groups', () => {
    const rows = [
      row('reading', 400, 2),
      row('reading', 1000, 1, { cached: true }),
      row('extracting', 30_000, 4, { model: 'ollama:a' }),
      row('extracting', 5, 20, { model: 'ollama:a', cached: true }),
      row('extracting', 3, 9, { model: 'ollama:b', cached: true }),
      row('extracting', 9000, 1, { model: 'ollama:c' }),
      { kind: 'validation', stage: 'rules', model: '', cached: false, ms: 700, samples: 5 },
    ];
    const out = buildEstimates(rows, [{ model: 'ollama:c', samples: 10, ms: 12_000 }, { model: 'ollama:d', samples: 2, ms: 50_000 }]);
    assert.deepEqual(out.models, { 'ollama:a': { ms: 30_000, samples: 4 }, 'ollama:c': { ms: 12_000, samples: 10 }, 'ollama:d': { ms: 50_000, samples: 2 } });
    assert.deepEqual(out.extraction.reading, { ms: 600, samples: 3 });
    assert.deepEqual(out.validation.rules, { ms: 700, samples: 5 });
  });

  it('counts only cached (paced) calls in the read-only demo', () => {
    const rows = [row('extracting', 2500, 6, { model: 'ollama:a', cached: true }), row('extracting', 30_000, 1, { model: 'ollama:a' })];
    assert.deepEqual(buildEstimates(rows, [{ model: 'ollama:a', samples: 9, ms: 40_000 }], true).models, { 'ollama:a': { ms: 2500, samples: 6 } });
  });
});
