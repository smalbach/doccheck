// End-to-end tests of the integrations (docs/INTEGRATIONS.md) against the built API and a real
// Postgres: the public API v1 with API keys, scopes, rate limits and idempotency; the OpenAPI
// document; webhooks with signatures, retries and redelivery; chat alerts; exports; container
// tracking; folder ingestion; and the events behind them. No model and no PDFs are needed: extracted
// documents are written straight to the database, as the extraction worker would.
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Uses DATABASE_URL_INTEGRATIONS_TEST, or DATABASE_URL with the database renamed to
// doccheck_integrations_test (its own, so it runs beside e2e.test.mjs). The schema is dropped and recreated.
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const root = resolve(import.meta.dirname, '../../..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {}
const require = createRequire(import.meta.url);
const { verifySignature } = require(join(root, 'packages/integrations/dist/index.js'));

const testUrl = (() => {
  if (process.env.DATABASE_URL_INTEGRATIONS_TEST) return process.env.DATABASE_URL_INTEGRATIONS_TEST;
  const u = new URL(process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  u.pathname = '/doccheck_integrations_test';
  return u.toString();
})();
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

const port = Number(process.env.E2E_INTEGRATIONS_PORT ?? 3994);
const base = `http://localhost:${port}`;
const inbox = mkdtempSync(join(tmpdir(), 'doccheck-inbox-'));
let api;
let pool;
let repo;
let progressRepo;

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

const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';
let cookie = '';

/** A request with a session cookie (the app) or an API key (the public API). */
async function call(method, path, body, { as = cookie, key, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(as ? { cookie: as } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers, cookie: sessionCookie(res) };
}
const v1 = (method, path, key, body, headers) => call(method, `/api/v1${path}`, body, { as: '', key, headers });

const signUp = async (name = 'Integrator') => {
  const res = await call('POST', '/auth/register', { email: `${randomUUID()}@example.com`, password: 'correct horse battery', name }, { as: '' });
  assert.equal(res.status, 201);
  return res.cookie;
};
const newKey = async (scopes = ['read', 'write'], extra = {}, as = cookie) => {
  const res = await call('POST', '/integrations/api-keys', { name: 'Test key', scopes, ...extra }, { as });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** A shipment of `as` with the three sample documents extracted (written as the worker would), plus their ids. */
async function extractedShipment(as, { reference = `REF-${randomUUID().slice(0, 6)}`, bl = sampleBillOfLading, announce = false } = {}) {
  const { body: s } = await call('POST', '/shipments', { destination: 'CA', reference }, { as });
  const ids = {};
  for (const [type, data] of Object.entries({ COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: bl })) {
    const id = randomUUID();
    ids[type] = id;
    await repo.insertDocument({ id, shipmentId: s.id, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
    // The worker's last progress event, which the API turns into document.extracted.
    if (announce) await progressRepo.insert({ kind: 'extraction', stage: 'saved', status: 'done', shipmentId: s.id, documentId: id, runId: randomUUID(), detail: { documentType: type, normalized: true, pages: 1 } }, 7900);
  }
  return { shipment: s, ids };
}

/** A local HTTP server standing in for a webhook receiver (or Slack/Teams). `answer` picks the status per request. */
async function receiver(answer = () => 200) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body, json: (() => { try { return JSON.parse(body); } catch { return undefined; } })() });
      res.statusCode = answer(requests.length);
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, requests, close: () => new Promise((r) => server.close(r)) };
}

before(async () => {
  await resetDatabase();
  api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: testUrl,
      REDIS_URL: '',
      S3_ENDPOINT: '',
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-int-')),
      LLM_CACHE_DIR: join(root, 'eval/cache/ollama_qwen3.8'),
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
      SMTP_URL: '',
      IMAP_URL: '',
      MAIL_CAPTURE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-int-mail-')),
      MAIL_FROM: 'DocCheck <docs@doccheck.example>',
      MAIL_OUTBOX_MS: '200',
      MAIL_INBOUND_SECRET: 'inbound-secret',
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-int-key-')), 'settings.key'),
      APP_URL: 'http://app.example/',
      // Receivers in these tests listen on 127.0.0.1.
      INTEGRATIONS_ALLOW_PRIVATE_URLS: 'true',
      WEBHOOK_BACKOFF_MS: '100',
      WEBHOOK_MAX_ATTEMPTS: '3',
      WEBHOOK_POLL_MS: '100',
      INTEGRATION_REPLY_POLL_MS: '300',
      INGEST_LOCAL_ROOT: inbox,
      INGESTION_TICK_MS: '600000',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  cookie = await signUp();
  require('reflect-metadata');
  const { ShipmentsRepository } = require(join(root, 'apps/api/dist/shipments/shipments.repository.js'));
  const { ProgressRepository } = require(join(root, 'apps/api/dist/progress/progress.repository.js'));
  pool = new pg.Pool({ connectionString: testUrl });
  repo = new ShipmentsRepository(pool);
  progressRepo = new ProgressRepository(pool);
});

after(async () => {
  api?.kill();
  await pool?.end();
});

describe('API keys', () => {
  it('are managed with a session only, shown once, and listed by prefix', async () => {
    assert.equal((await call('GET', '/integrations/api-keys', undefined, { as: '' })).status, 401);
    const created = await newKey(['read']);
    assert.match(created.key, /^dck_[a-z0-9]{8}_[A-Za-z0-9]{32}$/);
    assert.ok(created.key.startsWith(created.prefix + '_'));
    assert.deepEqual([created.scopes, created.rateLimit, created.revokedAt], [['read'], 120, null]);
    const list = (await call('GET', '/integrations/api-keys')).body;
    const listed = list.find((k) => k.id === created.id);
    assert.equal(listed.prefix, created.prefix);
    assert.equal(JSON.stringify(list).includes(created.key), false);
    assert.equal((await call('POST', '/integrations/api-keys', { name: 'x', scopes: ['admin'] })).status, 400);
    // An API key does not open the app's own routes.
    assert.equal((await call('GET', '/shipments', undefined, { as: '', key: created.key })).status, 401);
  });

  it('authenticate /api/v1 by Bearer or X-API-Key, never by session, and note when they were used', async () => {
    const { key, id } = await newKey(['read']);
    assert.equal((await v1('GET', '/shipments')).status, 401);
    assert.equal((await v1('GET', '/shipments', 'dck_aaaaaaaa_' + 'x'.repeat(32))).status, 401);
    assert.equal((await call('GET', '/api/v1/shipments')).status, 401);
    assert.equal((await v1('GET', '/shipments', key)).status, 200);
    assert.equal((await call('GET', '/api/v1/shipments', undefined, { as: '', headers: { 'x-api-key': key } })).status, 200);
    await until(async () => (await call('GET', '/integrations/api-keys')).body.find((k) => k.id === id).lastUsedAt);
  });

  it('enforce scopes, revocation and the account boundary', async () => {
    const read = await newKey(['read']);
    const write = await newKey(['write']);
    assert.equal((await v1('POST', '/shipments', read.key, { destination: 'CA' })).status, 403);
    assert.equal((await v1('GET', '/shipments', write.key)).status, 403);
    const created = await v1('POST', '/shipments', write.key, { destination: 'US', reference: 'API-1' });
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.reference, created.body.destination, created.body.status, created.body.documents], ['API-1', 'US', 'RECEIVED', []]);
    assert.equal((await v1('GET', `/shipments/${created.body.id}`, read.key)).body.id, created.body.id);
    assert.equal((await v1('POST', '/shipments', write.key, { destination: 'MX' })).status, 400);
    assert.equal((await v1('POST', '/shipments', write.key, { destination: 'CA', extra: 1 })).status, 400);

    // Another account's key sees neither the shipment nor its id.
    const other = await newKey(['read'], {}, await signUp('Other'));
    assert.equal((await v1('GET', `/shipments/${created.body.id}`, other.key)).status, 404);
    assert.equal((await v1('GET', '/shipments', other.key)).body.total, 0);

    assert.equal((await call('POST', `/integrations/api-keys/${read.id}/revoke`)).body.revokedAt !== null, true);
    assert.equal((await v1('GET', '/shipments', read.key)).status, 401);
    assert.equal((await call('POST', `/integrations/api-keys/${read.id}/revoke`, undefined, { as: await signUp() })).status, 404);
  });

  it('limit requests per minute per key', async () => {
    const { key } = await newKey(['read'], { rateLimit: 3 });
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await v1('GET', '/shipments', key));
    assert.deepEqual(answers.map((a) => a.status), [200, 200, 200, 429]);
    assert.deepEqual(answers.map((a) => a.headers.get('ratelimit-remaining')), ['2', '1', '0', '0']);
    assert.equal(answers[0].headers.get('ratelimit-limit'), '3');
    assert.ok(Number(answers[3].headers.get('retry-after')) >= 1);
  });
});

describe('idempotency', () => {
  it('replays a create sent twice with the same key, and refuses the key for another request', async () => {
    const { key } = await newKey();
    const idem = { 'idempotency-key': `create-${randomUUID()}` };
    const first = await v1('POST', '/shipments', key, { reference: 'IDEM-1', destination: 'CA' }, idem);
    const again = await v1('POST', '/shipments', key, { reference: 'IDEM-1', destination: 'CA' }, idem);
    assert.deepEqual([first.status, again.status], [201, 201]);
    assert.equal(again.body.id, first.body.id);
    assert.equal(again.headers.get('idempotent-replayed'), 'true');
    assert.equal(first.headers.get('idempotent-replayed'), null);
    assert.equal((await v1('POST', '/shipments', key, { reference: 'IDEM-2', destination: 'CA' }, idem)).status, 422);
    assert.equal((await v1('GET', '/shipments?q=IDEM-1', key)).body.total, 1);
    // Keys are per API key: another key may use the same value.
    const other = await newKey();
    assert.notEqual((await v1('POST', '/shipments', other.key, { reference: 'IDEM-1', destination: 'CA' }, idem)).body.id, first.body.id);
  });

  it('replays an upload, and queues the PDF once', async () => {
    const { key } = await newKey();
    const { body: s } = await v1('POST', '/shipments', key, { destination: 'CA' });
    const upload = async (bytes, idemKey) => {
      const form = new FormData();
      form.append('files', new Blob([bytes], { type: 'application/pdf' }), 'invoice.pdf');
      const res = await fetch(`${base}/api/v1/shipments/${s.id}/documents`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'idempotency-key': idemKey }, body: form });
      return { status: res.status, body: await res.json(), replayed: res.headers.get('idempotent-replayed') };
    };
    const pdf = Buffer.from('%PDF-1.4\n% not a real document\n');
    const a = await upload(pdf, 'up-1');
    const b = await upload(pdf, 'up-1');
    assert.deepEqual([a.status, b.status, b.replayed], [202, 202, 'true']);
    assert.equal(b.body.documents[0].id, a.body.documents[0].id);
    assert.equal(a.body.documents[0].storageKey, undefined);
    assert.equal((await upload(Buffer.from('%PDF-1.4\n% another\n'), 'up-1')).status, 422);
    assert.equal((await v1('GET', `/shipments/${s.id}`, key)).body.documents.length, 1);
    const notPdf = new FormData();
    notPdf.append('files', new Blob(['hello']), 'x.txt');
    assert.equal((await fetch(`${base}/api/v1/shipments/${s.id}/documents`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: notPdf })).status, 400);
  });
});

describe('API v1 flow and OpenAPI', () => {
  it('serves an OpenAPI 3.1 document generated from the schemas, without a key', async () => {
    const { status, body } = await call('GET', '/api/v1/openapi.json', undefined, { as: '' });
    assert.equal(status, 200);
    assert.equal(body.openapi, '3.1.0');
    assert.deepEqual(Object.keys(body.paths).sort(), [
      '/api/v1/shipments', '/api/v1/shipments/{id}', '/api/v1/shipments/{id}/documents', '/api/v1/shipments/{id}/documents/{documentId}', '/api/v1/shipments/{id}/exports/{format}', '/api/v1/shipments/{id}/exports/{format}/send',
      '/api/v1/shipments/{id}/findings', '/api/v1/shipments/{id}/validate',
    ]);
    for (const id of ['Shipment', 'Document', 'Finding', 'Validation', 'ShipmentList', 'DocumentDetail', 'Error']) assert.ok(body.components.schemas[id], id);
    assert.deepEqual(body.components.schemas.Shipment.properties.destination.enum, ['CA', 'US']);
    assert.ok(body.webhooks['validation.completed']);
    assert.equal(body.servers[0].url, base);
  });

  it('validates, reads findings and extracted data, and exports', async () => {
    const { key } = await newKey();
    const { shipment, ids } = await extractedShipment(cookie, { bl: { ...sampleBillOfLading, totalPackages: 121 } });
    assert.equal((await v1('GET', `/shipments/${shipment.id}/findings`, key)).status, 404);
    assert.equal((await v1('GET', `/shipments/${shipment.id}/exports/cargowise-xml`, key)).status, 409);

    const queued = await v1('POST', `/shipments/${shipment.id}/validate?agent=false`, key);
    assert.deepEqual([queued.status, queued.body], [202, { shipmentId: shipment.id, status: 'VALIDATING' }]);
    const findings = await until(async () => {
      const r = await v1('GET', `/shipments/${shipment.id}/findings`, key);
      return r.status === 200 && r.body;
    });
    assert.ok(findings.findings.some((f) => f.ruleId === 'X2'));
    assert.ok(findings.findings.every((f) => /^[0-9a-f]{32}$/.test(f.fingerprint) && f.evidence.length > 0 && f.history === undefined));

    const waited = await v1('POST', `/shipments/${shipment.id}/validate?agent=false&wait=true`, key);
    assert.equal(waited.status, 200);
    assert.notEqual(waited.body.id, findings.id);

    const doc = await v1('GET', `/shipments/${shipment.id}/documents/${ids.BILL_OF_LADING}`, key);
    assert.deepEqual([doc.body.document.status, doc.body.documentType, doc.body.data.totalPackages], ['EXTRACTED', 'BILL_OF_LADING', 121]);

    const xml = await fetch(`${base}/api/v1/shipments/${shipment.id}/exports/cargowise-xml`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(xml.status, 200);
    assert.match(xml.headers.get('content-disposition'), /attachment; filename=".+\.cargowise\.xml"/);
    assert.match(await xml.text(), /<WayBillNumber>HBLSZ123456<\/WayBillNumber>/);
    const asn = await (await fetch(`${base}/api/v1/shipments/${shipment.id}/exports/x12-856`, { headers: { authorization: `Bearer ${key}` } })).text();
    assert.match(asn, /^ISA\*00\*/);
    assert.match(asn, /^TD1\*CTN\*121\*/m);
    assert.equal((await v1('GET', `/shipments/${shipment.id}/exports/pdf`, key)).status, 400);
    const sent = await v1('POST', `/shipments/${shipment.id}/exports/x12-310/send`, key, { connector: 'mock' });
    assert.deepEqual([sent.status, sent.body.status, sent.body.connector], [200, 'accepted', 'mock']);
    assert.match(sent.body.reference, /^MOCK-\d{6}$/);
    assert.equal((await v1('POST', `/shipments/${shipment.id}/exports/x12-310/send`, key, { connector: 'cargowise-live' })).status, 400);

    // The app downloads the same file with the session.
    const fromApp = await call('GET', `/shipments/${shipment.id}/exports/x12-310`);
    assert.equal(fromApp.status, 200);
    assert.match(fromApp.body, /^ISA\*/);

    // No destination: 400 before anything starts.
    const { body: bare } = await v1('POST', '/shipments', key, {});
    assert.equal((await v1('POST', `/shipments/${bare.id}/validate`, key)).status, 400);
  });
});

describe('webhooks', () => {
  it('refuses unsafe URLs when private addresses are not allowed', () => {
    const { checkUrl, isBlockedAddress } = require(join(root, 'apps/api/dist/integrations/safe-fetch.js'));
    // This test process does not set INTEGRATIONS_ALLOW_PRIVATE_URLS.
    assert.equal(process.env.INTEGRATIONS_ALLOW_PRIVATE_URLS, undefined);
    for (const url of ['http://example.com/hook', 'https://127.0.0.1/hook', 'https://localhost/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://10.1.2.3/', 'https://user:pw@example.com/', 'ftp://example.com/']) assert.ok(checkUrl(url), url);
    assert.equal(checkUrl('https://hooks.example.com/doccheck'), null);
    assert.deepEqual(['8.8.8.8', '192.168.1.10', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:808:808', 'fd00::1', '2606:4700::1111'].map(isBlockedAddress), [false, true, true, true, false, true, false]);
  });

  it('sends a signed test event and logs the delivery', async () => {
    const hook = await receiver();
    const created = await call('POST', '/integrations/webhooks', { url: hook.url, events: ['validation.completed'], description: 'ERP' });
    assert.equal(created.status, 201);
    assert.match(created.body.secret, /^whsec_[A-Za-z0-9]{32}$/);
    assert.equal((await call('GET', '/integrations/webhooks')).body.some((w) => 'secret' in w), false);
    assert.equal((await call('POST', `/integrations/webhooks/${created.body.id}/secret`)).body.secret, created.body.secret);

    const test = await call('POST', `/integrations/webhooks/${created.body.id}/test`);
    assert.equal(test.status, 200);
    await until(() => hook.requests.length === 1);
    const [req] = hook.requests;
    assert.equal(req.json.type, 'ping');
    assert.equal(req.headers['doccheck-event'], 'ping');
    assert.equal(req.headers['doccheck-delivery'], test.body.id);
    assert.equal(verifySignature(created.body.secret, req.body, req.headers['doccheck-signature']).ok, true);
    assert.equal(verifySignature('whsec_wrong', req.body, req.headers['doccheck-signature']).ok, false);
    const log = await until(async () => {
      const d = (await call('GET', `/integrations/webhooks/${created.body.id}/deliveries`)).body;
      return d[0]?.status === 'succeeded' && d;
    });
    assert.deepEqual([log[0].attempts, log[0].responseStatus, log[0].eventType], [1, 200, 'ping']);

    // A rotated secret signs from then on.
    const { body: rotated } = await call('POST', `/integrations/webhooks/${created.body.id}/rotate-secret`);
    await call('POST', `/integrations/webhooks/${created.body.id}/test`);
    await until(() => hook.requests.length === 2);
    assert.equal(verifySignature(rotated.secret, hook.requests[1].body, hook.requests[1].headers['doccheck-signature']).ok, true);
    await hook.close();
  });

  it('retries with backoff, gives up after the last attempt, and redelivers on request', async () => {
    const flaky = await receiver((n) => (n < 3 ? 500 : 200));
    const { body: w } = await call('POST', '/integrations/webhooks', { url: flaky.url, events: ['validation.completed'] });
    await call('POST', `/integrations/webhooks/${w.id}/test`);
    const ok = await until(async () => (await call('GET', `/integrations/webhooks/${w.id}/deliveries`)).body.find((d) => d.status !== 'pending'));
    assert.deepEqual([ok.status, ok.attempts, flaky.requests.length], ['succeeded', 3, 3]);

    const down = await receiver(() => 503);
    const { body: w2 } = await call('POST', '/integrations/webhooks', { url: down.url, events: ['validation.completed'] });
    await call('POST', `/integrations/webhooks/${w2.id}/test`);
    const failed = await until(async () => (await call('GET', `/integrations/webhooks/${w2.id}/deliveries`)).body.find((d) => d.status === 'failed'));
    assert.deepEqual([failed.attempts, failed.responseStatus, failed.error], [3, 503, 'Answered 503']);

    const again = await call('POST', `/integrations/deliveries/${failed.id}/redeliver`);
    assert.equal(again.body.redeliveryOf, failed.id);
    await until(() => down.requests.length === 4);
    assert.equal(down.requests[3].json.id, down.requests[0].json.id);
    // Another account cannot see or redeliver it.
    assert.equal((await call('POST', `/integrations/deliveries/${failed.id}/redeliver`, undefined, { as: await signUp() })).status, 404);
    await Promise.all([flaky.close(), down.close()]);
  });

  it('delivers document, validation and finding events, once each', async () => {
    const hook = await receiver();
    const me = await signUp('Events');
    const { body: w } = await call('POST', '/integrations/webhooks', { url: hook.url, events: ['document.extracted', 'validation.completed', 'finding.created', 'finding.resolved'] }, { as: me });
    const { shipment } = await extractedShipment(me, { reference: 'EVT-1', bl: { ...sampleBillOfLading, totalPackages: 121 }, announce: true });
    await until(() => hook.requests.filter((r) => r.json.type === 'document.extracted').length === 3);
    const extracted = hook.requests.find((r) => r.json.type === 'document.extracted').json;
    assert.deepEqual(Object.keys(extracted.data).sort(), ['document', 'shipment']);
    assert.deepEqual(extracted.data.shipment, { id: shipment.id, reference: 'EVT-1', url: `http://app.example/#/app/s/${shipment.id}` });
    assert.equal(extracted.data.document.normalized, true);

    const run = await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    const findings = run.body.findings;
    assert.ok(findings.length > 0);
    await until(() => hook.requests.filter((r) => r.json.type === 'finding.created').length === findings.length);
    const completed = await until(() => hook.requests.find((r) => r.json.type === 'validation.completed')?.json);
    assert.equal(completed.data.validation.id, run.body.validationId);
    assert.equal(completed.data.validation.findings, findings.length);

    // Fixed BL: the package finding is resolved on the next run.
    const { ids } = { ids: Object.fromEntries((await repo.listExtractions(shipment.id)).map((e) => [e.documentType, e.documentId])) };
    assert.equal((await call('PATCH', `/shipments/${shipment.id}/documents/${ids.BILL_OF_LADING}/data`, { changes: [{ path: '/totalPackages', value: 120 }] }, { as: me })).status, 200);
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    const resolved = await until(() => hook.requests.find((r) => r.json.type === 'finding.resolved')?.json);
    assert.equal(resolved.data.finding.ruleId, 'X2');

    // Every event once, however many processes heard it.
    const ids2 = hook.requests.map((r) => r.json.id);
    assert.equal(new Set(ids2).size, ids2.length);
    const stored = await pool.query('select count(*)::int as n from integration_events where account_id = (select user_id from shipments where id = $1)', [shipment.id]);
    assert.equal(stored.rows[0].n, ids2.length);
    await call('PATCH', `/integrations/webhooks/${w.id}`, { active: false }, { as: me });
    await hook.close();
  });

  it('tells about supplier replies', async () => {
    const hook = await receiver();
    const me = await signUp('Replies');
    await call('POST', '/integrations/webhooks', { url: hook.url, events: ['supplier.replied'] }, { as: me });
    const { shipment } = await extractedShipment(me, { reference: 'MAIL-9' });
    const created = await call('POST', '/mail/threads', { kind: 'conversation', shipmentId: shipment.id, to: ['supplier@example.com'], subject: 'Question about MAIL-9', body: 'Hello' }, { as: me });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { rows } = await pool.query('select token from mail_threads where id = $1', [created.body.id]);
    const raw = `From: Supplier <supplier@example.com>\r\nTo: docs@doccheck.example\r\nSubject: Re: Question [DC-${rows[0].token}]\r\nMessage-ID: <${randomUUID()}@example.com>\r\n\r\nHere you go.\r\n`;
    const inbound = await fetch(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'inbound-secret' }, body: raw });
    assert.equal(inbound.status, 202);
    const replied = await until(() => hook.requests.find((r) => r.json.type === 'supplier.replied')?.json);
    assert.equal(replied.data.thread.id, created.body.id);
    assert.equal(replied.data.shipment.reference, 'MAIL-9');
    assert.equal(replied.data.message.from, 'Supplier <supplier@example.com>');
    await hook.close();
  });
});

describe('chat alerts', () => {
  it('posts Slack and Teams messages that quote nothing from the documents unless asked', async () => {
    const slack = await receiver();
    const teams = await receiver();
    const me = await signUp('Chat');
    // Real Slack URLs only, unless private URLs are allowed (as in this test server).
    assert.equal((await call('POST', '/integrations/chat-alerts', { kind: 'slack', name: 'x', url: 'https://example.com/hook', events: ['validation.completed'] }, { as: me })).status, 201);
    const a = await call('POST', '/integrations/chat-alerts', { kind: 'slack', name: '#customs', url: slack.url, events: ['finding.created'] }, { as: me });
    assert.deepEqual([a.status, a.body.urlHost, a.body.includeDetails, 'url' in a.body], [201, new URL(slack.url).host, false, false]);
    const b = await call('POST', '/integrations/chat-alerts', { kind: 'teams', name: 'Customs', url: teams.url, events: ['finding.created'], includeDetails: true }, { as: me });
    assert.equal(b.status, 201);

    await call('POST', `/integrations/chat-alerts/${a.body.id}/test`, undefined, { as: me });
    await until(() => slack.requests.length === 1);
    assert.equal(slack.requests[0].json.text, 'DocCheck test message');

    const { shipment } = await extractedShipment(me, { reference: 'CHAT-1', bl: { ...sampleBillOfLading, totalPackages: 121 } });
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    const x2 = await until(() => slack.requests.find((r) => JSON.stringify(r.json).includes('X2'))?.json);
    const text = JSON.stringify(x2);
    assert.match(text, /New finding: CHAT-1/);
    assert.match(text, /http:\/\/app\.example\/#\/app\/s\//);
    assert.doesNotMatch(text, /121/);
    const card = await until(() => teams.requests.find((r) => JSON.stringify(r.json).includes('X2'))?.json);
    assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
    assert.match(JSON.stringify(card), /121/);

    assert.equal((await call('DELETE', `/integrations/chat-alerts/${a.body.id}`, undefined, { as: me })).status, 204);
    assert.equal((await call('GET', `/integrations/chat-alerts/${a.body.id}/deliveries`, undefined, { as: me })).body.length, 0);
    await Promise.all([slack.close(), teams.close()]);
  });
});

describe('container tracking', () => {
  const bl = { ...sampleBillOfLading, vessel: 'EXAMPLE STAR', voyage: '012E', shippedOnBoardDate: '2026-10-05' };

  it('is off by default and adds T findings from the provider when on', async () => {
    const me = await signUp('Tracking');
    assert.deepEqual((await call('GET', '/integrations/tracking', undefined, { as: me })).body.enabled, false);
    const { shipment } = await extractedShipment(me, { bl });
    const first = await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    assert.equal(first.body.findings.some((f) => f.ruleId.startsWith('T')), false);

    assert.equal((await call('PUT', '/integrations/tracking', { enabled: true, provider: 'vizion' }, { as: me })).status, 400);
    const saved = await call('PUT', '/integrations/tracking', { enabled: true, provider: 'mock', mockScenario: 'conflicting' }, { as: me });
    assert.deepEqual([saved.status, saved.body.enabled, saved.body.mockScenario], [200, true, 'conflicting']);
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    const latest = await until(async () => {
      const v = (await call('GET', `/shipments/${shipment.id}/validation`, undefined, { as: me })).body;
      return v.findings.filter((f) => f.ruleId.startsWith('T')).length === 3 && v;
    });
    const t1 = latest.findings.find((f) => f.ruleId === 'T1');
    assert.deepEqual([...new Set(t1.evidence.map((e) => e.documentId))].length, 2);
    assert.ok(t1.evidence.some((e) => e.documentId === 'tracking:mock' && e.value === 'MOCK DIFFERENT VESSEL'));
    const events = (await call('GET', `/shipments/${shipment.id}/tracking`, undefined, { as: me })).body;
    assert.deepEqual([events.provider, events.findings, events.events.length], ['mock', 3, 4]);

    // Consistent events: the T findings are gone on the next run.
    await call('PUT', '/integrations/tracking', { enabled: true, provider: 'mock', mockScenario: 'consistent' }, { as: me });
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, { as: me });
    await until(async () => (await call('GET', `/shipments/${shipment.id}/tracking`, undefined, { as: me })).body.findings === 0);
    const after = (await call('GET', `/shipments/${shipment.id}/validation`, undefined, { as: me })).body;
    assert.equal(after.findings.some((f) => f.ruleId.startsWith('T')), false);
    assert.ok(after.resolved.some((f) => f.ruleId === 'T3'));
  });
});

describe('folder ingestion', () => {
  it('turns dropped PDFs into shipments grouped by reference, once', async () => {
    const me = await signUp('Ingestion');
    const dir = join(inbox, `drop-${randomUUID().slice(0, 8)}`);
    mkdirSync(join(dir, 'SHP-77'), { recursive: true });
    const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n`);
    writeFileSync(join(dir, 'SHP-77', 'invoice.pdf'), pdf('invoice'));
    writeFileSync(join(dir, 'SHP-77', 'bl.pdf'), pdf('bl'));
    writeFileSync(join(dir, 'loose.pdf'), pdf('no folder'));
    writeFileSync(join(dir, 'SHP-77', 'notes.txt'), 'not a pdf');

    const source = { name: 'Drop folder', kind: 'local', config: { path: dir }, groupBy: 'folder', destination: 'CA', validate: false, pollSeconds: 300, active: true };
    assert.equal((await call('POST', '/integrations/ingestion', { ...source, config: { path: '/etc' } }, { as: me })).status, 400);
    assert.equal((await call('POST', '/integrations/ingestion', { ...source, groupBy: 'filename', pattern: '(a+)+' }, { as: me })).status, 400);
    const test = await call('POST', '/integrations/ingestion/test', source, { as: me });
    assert.deepEqual([test.body.ok, test.body.pdfs], [true, 3]);
    assert.ok(test.body.sample.some((f) => f.path === 'SHP-77/bl.pdf' && f.reference === 'SHP-77'));

    const { body: created } = await call('POST', '/integrations/ingestion', source, { as: me });
    const polled = (await call('POST', `/integrations/ingestion/${created.id}/poll`, undefined, { as: me })).body;
    assert.deepEqual(polled.recent.map((f) => `${f.path}:${f.status}`).sort(), ['SHP-77/bl.pdf:imported', 'SHP-77/invoice.pdf:imported', 'loose.pdf:skipped']);
    const list = (await call('GET', '/shipments?q=SHP-77', undefined, { as: me })).body;
    assert.equal(list.total, 1);
    assert.deepEqual([list.items[0].reference, list.items[0].destination, list.items[0].documentCount], ['SHP-77', 'CA', 2]);

    // Nothing new: nothing imported again. A new file joins the same shipment.
    writeFileSync(join(dir, 'SHP-77', 'packing.pdf'), pdf('packing'));
    await call('POST', `/integrations/ingestion/${created.id}/poll`, undefined, { as: me });
    const again = (await call('GET', '/shipments?q=SHP-77', undefined, { as: me })).body;
    assert.deepEqual([again.total, again.items[0].documentCount], [1, 3]);
    // Not another account's to see.
    assert.equal((await call('POST', `/integrations/ingestion/${created.id}/poll`, undefined, { as: await signUp() })).status, 404);
  });
});
