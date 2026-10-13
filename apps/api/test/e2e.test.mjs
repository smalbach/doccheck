// End-to-end tests of the built API against a real Postgres. No model is needed: documents are
// sent as normalized JSON, the agent is off, and PDF extraction is covered only when the generated
// evaluation set and its cached model responses exist (replay mode, still no model).
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Uses DATABASE_URL_TEST, or DATABASE_URL with the database renamed to doccheck_test. The schema is
// dropped and recreated, so the database name must end in "_test".
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const root = resolve(import.meta.dirname, '../../..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {}

const testUrl = (() => {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const u = new URL(process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  u.pathname = '/doccheck_test';
  return u.toString();
})();
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

const port = 3990;
const base = `http://localhost:${port}`;
let api;

async function resetDatabase() {
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  const exists = await c.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await c.query(`create database ${dbName}`);
  await c.end();
  const t = new pg.Client({ connectionString: testUrl });
  await t.connect();
  await t.query('drop schema public cascade; create schema public');
  await t.end();
}

const call = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

before(async () => {
  await resetDatabase();
  api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: testUrl,
      // In-process extraction and local disk: no Redis or S3 needed.
      REDIS_URL: '',
      S3_ENDPOINT: '',
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-e2e-')),
      LLM_CACHE_DIR: join(root, 'eval/cache/ollama_qwen3.8'),
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not start');
});

after(() => api?.kill());

describe('shipments', () => {
  it('reports health with the database', async () => {
    const { body } = await call('GET', '/health');
    assert.equal(body.database, 'ok');
  });

  it('creates, lists and rejects unknown shipments', async () => {
    const created = await call('POST', '/shipments', { reference: 'E2E-1', destination: 'CA' });
    assert.equal(created.status, 201);
    const list = await call('GET', '/shipments');
    assert.ok(list.body.some((s) => s.id === created.body.id && s.documentCount === 0 && s.findingCount === null));
    assert.equal((await call('GET', '/shipments/not-a-uuid')).status, 404);
    assert.equal((await call('GET', '/shipments/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await call('POST', '/shipments', { destination: 'MX' })).status, 400);
  });

  it('validates JSON documents, stores the run and returns it later', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    assert.equal((await call('GET', `/shipments/${s.id}/validation`)).status, 404);

    const bl = structuredClone(sampleBillOfLading);
    bl.totalPackages = 121;
    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`, { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: bl });
    assert.equal(run.status, 200);
    assert.deepEqual(run.body.findings.map((f) => f.ruleId), ['X2']);
    assert.notEqual(run.body.agent.status, 'done'); // agent off; 'failed' when no model is reachable for citations

    const stored = await call('GET', `/shipments/${s.id}/validation`);
    assert.equal(stored.body.id, run.body.validationId);
    assert.deepEqual(stored.body.inputs, { invoice: 'body', packingList: 'body', billOfLading: 'body' });
    assert.deepEqual((await call('GET', `/shipments/${s.id}/findings`)).body.map((f) => f.ruleId), ['X2']);
    assert.equal((await call('GET', `/shipments/${s.id}`)).body.status, 'DONE');
  });

  it('requires a destination before validating', async () => {
    const { body: s } = await call('POST', '/shipments', {});
    assert.equal((await call('POST', `/shipments/${s.id}/validate`)).status, 400);
  });

  it('rejects an upload that is not a PDF', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const form = new FormData();
    form.append('files', new Blob(['hello'], { type: 'application/pdf' }), 'fake.pdf');
    const res = await fetch(`${base}/shipments/${s.id}/documents`, { method: 'POST', body: form });
    assert.equal(res.status, 400);
  });
});

describe('ISF', () => {
  const isf = {
    seller: sampleInvoice.seller,
    buyer: sampleInvoice.buyer,
    importerOfRecordNumber: '12-345678900',
    consigneeNumber: '12-345678900',
    manufacturer: sampleInvoice.seller,
    shipToParty: sampleInvoice.buyer,
    countryOfOrigin: 'CN',
    htsCode: '950300',
    containerStuffingLocation: sampleInvoice.seller.address,
    consolidator: sampleInvoice.seller,
  };
  const usInvoice = { ...sampleInvoice, portOfEntry: { name: 'Los Angeles', unLocode: 'USLAX', country: 'US' } };

  it('is stored per US shipment and used by X11', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'US' });
    const docs = { invoice: usInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading };

    const without = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs);
    assert.deepEqual(without.body.skipped.map((x) => x.ruleId), ['X11']);

    assert.equal((await call('PUT', `/shipments/${s.id}/isf`, isf)).status, 200);
    const clean = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs);
    assert.ok(clean.body.ran.includes('X11'));
    assert.deepEqual(clean.body.findings, []);

    await call('PUT', `/shipments/${s.id}/isf`, { ...isf, countryOfOrigin: 'VN' });
    const mismatch = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs);
    assert.deepEqual(mismatch.body.findings.map((f) => f.ruleId), ['X11']);

    assert.equal((await call('DELETE', `/shipments/${s.id}/isf`)).status, 204);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).status, 404);
  });

  it('is rejected when invalid or for a Canadian shipment', async () => {
    const { body: us } = await call('POST', '/shipments', { destination: 'US' });
    assert.equal((await call('PUT', `/shipments/${us.id}/isf`, { seller: 1 })).status, 400);
    const { body: ca } = await call('POST', '/shipments', { destination: 'CA' });
    assert.equal((await call('PUT', `/shipments/${ca.id}/isf`, isf)).status, 400);
  });
});

// PDF path: only when the evaluation set and the cached model responses for CA-001 exist locally.
const sample = join(root, 'data/eval/v1/CA-001');
const hasSample = existsSync(join(sample, 'invoice.pdf')) && existsSync(join(root, 'eval/cache/ollama_qwen3.8'));
describe('PDF upload', { skip: !hasSample && 'evaluation set not generated' }, () => {
  it('extracts uploaded PDFs, cites the page and serves the file', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const form = new FormData();
    for (const f of ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf']) form.append('files', new Blob([readFileSync(join(sample, f))], { type: 'application/pdf' }), f);
    const up = await fetch(`${base}/shipments/${s.id}/documents?wait=true`, { method: 'POST', body: form });
    assert.equal(up.status, 202);
    const { documents } = await up.json();
    assert.deepEqual(documents.map((d) => d.document.status), ['EXTRACTED', 'EXTRACTED', 'EXTRACTED']);

    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`);
    const expected = JSON.parse(readFileSync(join(sample, 'labels.json'), 'utf8')).errors.flatMap((e) => e.expectedRuleIds).sort();
    assert.deepEqual([...new Set(run.body.findings.map((f) => f.ruleId))].sort(), expected);
    assert.ok(run.body.findings.every((f) => f.evidence.some((e) => e.source?.page === 1)));

    const invoiceId = documents[0].document.id;
    const again = await fetch(`${base}/shipments/${s.id}/documents/${invoiceId}/reextract?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'COMMERCIAL_INVOICE' }) });
    assert.equal(again.status, 202);
    assert.deepEqual([(await again.json()).document.status, (await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body.document.typeConfidence], ['EXTRACTED', 1]);
    assert.equal((await call('POST', `/shipments/${s.id}/documents/${invoiceId}/reextract`, { type: 'ISF' })).status, 400);

    const file = await fetch(`${base}/shipments/${s.id}/documents/${documents[0].document.id}/file`);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal((await file.arrayBuffer()).byteLength, readFileSync(join(sample, 'invoice.pdf')).length);
  });
});
