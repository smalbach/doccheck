// Usage metering, plans, the Stripe test-mode webhook and the review queue, against the built API and
// a real Postgres (npm run build first). No model and no Stripe account are needed: validations run on
// JSON documents, webhook events are signed here with the test secret, and the review queue is fed
// rows written straight to the database.
//
// Uses DATABASE_URL_USAGE_TEST, else DATABASE_URL_TEST (or DATABASE_URL renamed to doccheck_test) with
// "_test" turned into "_usage_test"; it is dropped and recreated, so its name must end in "_test".
// The port is USAGE_E2E_PORT, else E2E_PORT + 2 (the orgs suite takes E2E_PORT + 1).
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
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
const { allows, meter, monthOf, nextMonth } = require('../dist/usage/limits.js');
const { formEncode, signStripePayload, stripeSetup, verifyStripeSignature } = require('../dist/billing/stripe.js');

const testUrl = (() => {
  if (process.env.DATABASE_URL_USAGE_TEST) return process.env.DATABASE_URL_USAGE_TEST;
  const u = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  if (!process.env.DATABASE_URL_TEST) u.pathname = '/doccheck_test';
  u.pathname = u.pathname.replace(/_test$/, '_usage_test');
  return u.toString();
})();
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

const port = Number(process.env.USAGE_E2E_PORT ?? Number(process.env.E2E_PORT ?? 3990) + 2);
const base = `http://localhost:${port}`;
const WEBHOOK_SECRET = 'whsec_e2e_test_secret';
const ADMIN = 'usage-admin@example.com';
let api;
let pool;

const plan = { id: 'free', name: 'Free', position: 0, extractionsPerMonth: 10, validationsPerMonth: 4, warnPercent: 75, enforcement: 'hard' };

describe('limits', () => {
  it('moves from ok to warning to blocked on a hard plan, and to over on a soft one', () => {
    assert.equal(meter(plan, 'validation', 2).state, 'ok');
    assert.deepEqual(meter(plan, 'validation', 3), { kind: 'validation', used: 3, limit: 4, remaining: 1, percent: 75, state: 'warning' });
    assert.equal(meter(plan, 'validation', 4).state, 'blocked');
    assert.equal(meter({ ...plan, enforcement: 'soft' }, 'validation', 5).state, 'over');
    assert.equal(meter({ ...plan, enforcement: 'soft' }, 'validation', 5).remaining, 0);
    assert.deepEqual(meter({ ...plan, validationsPerMonth: null }, 'validation', 900), { kind: 'validation', used: 900, limit: null, remaining: null, percent: null, state: 'ok' });
    assert.equal(meter({ ...plan, validationsPerMonth: 0 }, 'validation', 0).state, 'blocked');
  });

  it('refuses a batch that would pass a hard limit as a whole', () => {
    assert.equal(allows(plan, 'extraction', 7, 3), true);
    assert.equal(allows(plan, 'extraction', 7, 4), false);
    assert.equal(allows({ ...plan, enforcement: 'soft' }, 'extraction', 70, 4), true);
    assert.equal(allows({ ...plan, extractionsPerMonth: null }, 'extraction', 70, 4), true);
  });

  it('counts per calendar month in UTC', () => {
    assert.equal(monthOf(new Date('2026-10-31T23:59:59Z')), '2026-10-01');
    assert.equal(monthOf(new Date('2026-11-01T00:00:00Z')), '2026-11-01');
    assert.equal(nextMonth(new Date('2026-12-15T10:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  });
});

describe('stripe (test mode only)', () => {
  const env = { STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PRICE_PRO: 'price_pro123' };

  it('is on only with a test key, a webhook secret and a price', () => {
    assert.deepEqual(stripeSetup(env), { enabled: true, config: { secretKey: 'sk_test_abc123', webhookSecret: WEBHOOK_SECRET, prices: { pro: 'price_pro123' } } });
    assert.equal(stripeSetup({}).enabled, false);
    const live = stripeSetup({ ...env, STRIPE_SECRET_KEY: 'sk_live_abc123' });
    assert.equal(live.enabled, false);
    assert.match(live.reason, /test-mode/);
    assert.equal(stripeSetup({ ...env, STRIPE_WEBHOOK_SECRET: '' }).enabled, false);
    assert.equal(stripeSetup({ ...env, STRIPE_PRICE_PRO: '' }).enabled, false);
  });

  it('checks webhook signatures and their age', () => {
    const body = '{"id":"evt_1"}';
    const now = Date.parse('2026-10-16T12:00:00Z');
    verifyStripeSignature(Buffer.from(body), signStripePayload(body, WEBHOOK_SECRET, now), WEBHOOK_SECRET, now);
    assert.throws(() => verifyStripeSignature(Buffer.from(body), signStripePayload(body, 'whsec_other', now), WEBHOOK_SECRET, now), /does not match/);
    assert.throws(() => verifyStripeSignature(Buffer.from(`${body} `), signStripePayload(body, WEBHOOK_SECRET, now), WEBHOOK_SECRET, now), /does not match/);
    assert.throws(() => verifyStripeSignature(Buffer.from(body), signStripePayload(body, WEBHOOK_SECRET, now - 600_000), WEBHOOK_SECRET, now), /too old/);
    assert.throws(() => verifyStripeSignature(Buffer.from(body), undefined, WEBHOOK_SECRET, now), /Missing/);
  });

  it('form-encodes nested parameters like Stripe expects', () => {
    assert.deepEqual(formEncode({ mode: 'subscription', line_items: [{ price: 'p_1', quantity: 1 }], metadata: { plan: 'pro' }, skip: undefined }), [
      'mode=subscription',
      'line_items%5B0%5D%5Bprice%5D=p_1',
      'line_items%5B0%5D%5Bquantity%5D=1',
      'metadata%5Bplan%5D=pro',
    ]);
  });
});

const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';
const call = async (method, path, body, cookie) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: sessionCookie(res) };
};
const signUp = async (email) => {
  const res = await call('POST', '/auth/register', { email, password: 'correct horse battery', name: 'Usage Tester' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const orgs = await call('GET', '/orgs', undefined, res.cookie);
  return { cookie: res.cookie, id: res.body.id, orgId: orgs.body.active.id };
};
const webhook = (event, secret = WEBHOOK_SECRET) => {
  const body = JSON.stringify(event);
  return fetch(`${base}/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(body, secret) }, body });
};

describe('usage, plans and billing over HTTP', () => {
  let admin;
  let user;

  before(async () => {
    const admUrl = new URL(testUrl);
    admUrl.pathname = '/postgres';
    const c = new pg.Client({ connectionString: admUrl.toString() });
    await c.connect();
    if ((await c.query('select 1 from pg_database where datname = $1', [dbName])).rowCount === 0) await c.query(`create database ${dbName}`);
    await c.end();
    const t = new pg.Client({ connectionString: testUrl });
    await t.connect();
    await t.query('drop schema public cascade; create schema public');
    await t.end();
    pool = new pg.Pool({ connectionString: testUrl });

    api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: testUrl,
        REDIS_URL: '',
        S3_ENDPOINT: '',
        STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-usage-')),
        ADMIN_EMAILS: ADMIN,
        AGENT_ENABLED: 'false',
        SMTP_URL: '',
        IMAP_URL: '',
        LLM_CACHE_MODE: 'replay',
        OLLAMA_BASE_URL: 'http://127.0.0.1:9',
        APP_URL: 'http://app.example/',
        USAGE_ENFORCEMENT: 'true',
        STRIPE_SECRET_KEY: 'sk_test_e2e',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        STRIPE_PRICE_PRO: 'price_e2e_pro',
        STRIPE_PRICE_BUSINESS: '',
        SUPPLIER_LEARNING: 'true',
        REVIEW_THRESHOLD: '0.85',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    // Up to a minute: the other suites start their own API at the same time.
    let up = false;
    for (let i = 0; i < 240 && !up; i++) {
      try {
        up = (await fetch(`${base}/health`)).ok;
      } catch {}
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    if (!up) throw new Error('API did not start');
    admin = await signUp(ADMIN);
    user = await signUp(`${randomUUID()}@example.com`);
  });

  after(async () => {
    api?.kill();
    await pool?.end();
  });

  const validateOnce = async (cookie) => {
    const shipment = await call('POST', '/shipments', { destination: 'CA', transportMode: 'SEA' }, cookie);
    return call('POST', `/shipments/${shipment.body.id}/validate?agent=false`, { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading }, cookie);
  };

  it('counts validations and refuses them past a hard limit with 402', async () => {
    const usage = await call('GET', '/usage', undefined, user.cookie);
    assert.equal(usage.status, 200);
    assert.equal(usage.body.plan.id, 'free');
    assert.equal(usage.body.enforced, true);
    assert.deepEqual(usage.body.meters.map((m) => [m.kind, m.used]), [['extraction', 0], ['validation', 0]]);

    // Only admins change plans.
    const limits = { name: 'Free', extractionsPerMonth: 50, validationsPerMonth: 2, warnPercent: 50, enforcement: 'hard' };
    assert.equal((await call('PUT', '/admin/plans/free', limits, user.cookie)).status, 403);
    assert.equal((await call('PUT', '/admin/plans/free', { ...limits, warnPercent: 0 }, admin.cookie)).status, 400);
    assert.equal((await call('PUT', '/admin/plans/free', limits, admin.cookie)).body.validationsPerMonth, 2);

    assert.equal((await validateOnce(user.cookie)).status, 200);
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.meters[1].state, 'warning');
    assert.equal((await validateOnce(user.cookie)).status, 200);
    const refused = await validateOnce(user.cookie);
    assert.equal(refused.status, 402);
    assert.equal(refused.body.code, 'usage_limit');
    assert.equal(refused.body.kind, 'validation');
    assert.match(refused.body.message, /includes 2 validations a month and 2 are used/);
    const after = await call('GET', '/usage', undefined, user.cookie);
    assert.deepEqual(after.body.meters[1], { kind: 'validation', used: 2, limit: 2, remaining: 0, percent: 100, state: 'blocked' });

    // An organization owned by a server admin is counted but never refused.
    await validateOnce(admin.cookie);
    await validateOnce(admin.cookie);
    assert.equal((await validateOnce(admin.cookie)).status, 200);
    const orgs = (await call('GET', '/admin/usage', undefined, admin.cookie)).body.orgs;
    assert.equal(orgs.find((o) => o.orgId === admin.orgId).validation, 3);
    assert.equal(orgs.find((o) => o.orgId === user.orgId).validation, 2);
    assert.equal((await call('GET', '/admin/usage', undefined, user.cookie)).status, 403);

    // A server admin puts an organization on a plan by hand, and it is in the audit log.
    assert.equal((await call('PUT', `/admin/usage/${user.orgId}/plan`, { plan: 'business' }, admin.cookie)).body.orgs.find((o) => o.orgId === user.orgId).plan, 'business');
    assert.equal((await validateOnce(user.cookie)).status, 200);
    assert.equal((await call('PUT', `/admin/usage/${user.orgId}/plan`, { plan: 'free' }, admin.cookie)).status, 200);
    const planRows = (await pool.query("select before, after from audit_log where action = 'org.plan' and entity_id = $1 order by id", [user.orgId])).rows;
    assert.deepEqual(planRows.map((r) => [r.before.plan, r.after.plan]), [['free', 'business'], ['business', 'free']]);

    // A soft plan lets work go on past the limit and shows it.
    await call('PUT', '/admin/plans/free', { ...limits, enforcement: 'soft' }, admin.cookie);
    assert.equal((await validateOnce(user.cookie)).status, 200);
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.meters[1].state, 'over');
    // The counters are the organization's: a member counts in it, not in their personal one.
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.meters[1].used, 4);
  });

  it('refuses an upload that would pass the extraction limit, before storing anything', async () => {
    await call('PUT', '/admin/plans/free', { name: 'Free', extractionsPerMonth: 1, validationsPerMonth: 100, warnPercent: 80, enforcement: 'hard' }, admin.cookie);
    const shipment = await call('POST', '/shipments', { destination: 'CA', transportMode: 'SEA' }, user.cookie);
    const form = new FormData();
    for (const name of ['a.pdf', 'b.pdf']) form.append('files', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), name);
    const res = await fetch(`${base}/shipments/${shipment.body.id}/documents`, { method: 'POST', headers: { cookie: user.cookie }, body: form });
    assert.equal(res.status, 402);
    assert.match((await res.json()).message, /1 document extraction a month and 0 are used \(1 left, 2 asked\)/);
    assert.equal((await call('GET', `/shipments/${shipment.body.id}`, undefined, user.cookie)).body.documents.length, 0);
  });

  it('sets the plan from signed Stripe test events, once each, and refuses forged or live ones', async () => {
    assert.deepEqual((await call('GET', '/billing', undefined, user.cookie)).body, { enabled: true, plans: ['pro'] });
    // No subscription yet: nothing to manage.
    assert.equal((await call('POST', '/billing/portal', undefined, user.cookie)).status, 400);
    assert.equal((await call('POST', '/billing/checkout', { plan: 'business' }, user.cookie)).status, 400);

    const completed = { id: `evt_${randomUUID()}`, type: 'checkout.session.completed', livemode: false, data: { object: { client_reference_id: user.orgId, customer: 'cus_e2e', subscription: 'sub_e2e', metadata: { plan: 'pro', org_id: user.orgId } } } };
    assert.equal((await webhook(completed, 'whsec_forged')).status, 400);
    assert.equal((await webhook({ ...completed, id: `evt_${randomUUID()}`, livemode: true })).status, 400);
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.plan.id, 'free');

    const res = await webhook(completed);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, applied: true });
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.plan.id, 'pro');
    // Stripe retries: the same event is not applied twice.
    assert.deepEqual(await (await webhook(completed)).json(), { received: true, applied: false });

    const deleted = { id: `evt_${randomUUID()}`, type: 'customer.subscription.deleted', livemode: false, data: { object: { id: 'sub_e2e', customer: 'cus_e2e', status: 'canceled', items: { data: [{ price: { id: 'price_e2e_pro' } }] } } } };
    assert.equal((await webhook(deleted)).status, 200);
    assert.equal((await call('GET', '/usage', undefined, user.cookie)).body.plan.id, 'free');

    // The webhook needs no session, but every other billing route does.
    assert.equal((await call('POST', '/billing/checkout', { plan: 'pro' })).status, 401);
  });

  it('queues documents with unsure values, records accepts and corrections, and learns from them', async () => {
    const shipment = (await call('POST', '/shipments', { destination: 'CA', transportMode: 'SEA' }, user.cookie)).body;
    const documentId = randomUUID();
    const raw = { netWeight: { value: '1,250', unit: 'KG' }, invoiceNumber: sampleInvoice.invoiceNumber };
    await pool.query(
      `insert into documents (id, shipment_id, file_name, storage_key, sha256, page_count, detected_type, type_confidence, status)
       values ($1, $2, 'invoice.pdf', $3, $4, 1, 'COMMERCIAL_INVOICE', 1, 'EXTRACTED')`,
      [documentId, shipment.id, `${shipment.id}/${documentId}.pdf`, createHash('sha256').update(documentId).digest('hex')],
    );
    const lines = [{ page: 1, text: `${sampleInvoice.seller.name}`, bbox: [10, 10, 200, 20] }, { page: 1, text: 'NET WT 1,250 KG   GROSS WT 1,200 KG', bbox: [10, 30, 300, 40] }];
    await pool.query(`insert into extractions (document_id, model, prompt_version, raw, data, issues, pdf_lines) values ($1, 'test', 'test', $2, $3, '[]', $4)`, [
      documentId,
      JSON.stringify(raw),
      JSON.stringify(sampleInvoice),
      JSON.stringify(lines),
    ]);
    const fields = [
      { path: '/netWeight/kg', value: sampleInvoice.netWeight?.kg ?? '1', printed: '1,250', confidence: 0.5, reasons: ['not-printed'] },
      { path: '/invoiceNumber', value: sampleInvoice.invoiceNumber, printed: sampleInvoice.invoiceNumber, confidence: 0.6, reasons: ['ocr'] },
      { path: '/currency', value: sampleInvoice.currency, printed: sampleInvoice.currency, confidence: 1, reasons: [] },
    ];
    await pool.query('insert into field_confidence (document_id, fields) values ($1, $2)', [documentId, JSON.stringify(fields)]);

    // Another account sees none of it.
    const other = await signUp(`${randomUUID()}@example.com`);
    assert.equal((await call('GET', '/review/queue', undefined, other.cookie)).body.total, 0);
    assert.equal((await call('GET', `/review/documents/${documentId}`, undefined, other.cookie)).status, 404);

    const queue = await call('GET', '/review/queue', undefined, user.cookie);
    assert.equal(queue.body.total, 1);
    assert.deepEqual(queue.body.items.map((i) => [i.documentId, i.pending, i.minConfidence]), [[documentId, 2, 0.5]]);
    assert.deepEqual((await call('GET', '/review/summary', undefined, user.cookie)).body, { documents: 1, fields: 2, threshold: 0.85 });

    const doc = await call('GET', `/review/documents/${documentId}`, undefined, user.cookie);
    assert.deepEqual(doc.body.fields.map((f) => [f.path, f.low]), [['/netWeight/kg', true], ['/invoiceNumber', true], ['/currency', false]]);

    assert.equal((await call('POST', `/review/documents/${documentId}/accept`, { paths: ['/lines/9/sku'] }, user.cookie)).status, 400);
    const accepted = await call('POST', `/review/documents/${documentId}/accept`, { paths: ['/invoiceNumber'] }, user.cookie);
    assert.equal(accepted.body.fields.find((f) => f.path === '/invoiceNumber').review.status, 'accepted');

    // A correction through the usual endpoint counts as the review, and becomes a supplier example.
    const corrected = await call('PATCH', `/shipments/${shipment.id}/documents/${documentId}/data`, { changes: [{ path: '/netWeight/kg', value: '1200' }] }, user.cookie);
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    const after = await call('GET', `/review/documents/${documentId}`, undefined, user.cookie);
    const net = after.body.fields.find((f) => f.path === '/netWeight/kg');
    assert.equal(net.review.status, 'corrected');
    assert.equal(net.value, '1200');
    assert.equal(net.modelValue, fields[0].value);
    assert.equal((await call('GET', '/review/queue', undefined, user.cookie)).body.total, 0);

    const learned = await call('GET', '/suppliers/examples', undefined, user.cookie);
    assert.equal(learned.body.enabled, true);
    assert.equal(learned.body.suppliers.length, 1);
    assert.deepEqual(learned.body.suppliers[0].examples.map((e) => [e.field, e.modelValue, e.correctValue, e.line]), [['netWeight.value', '1,250', '1200', 'NET WT 1,250 KG GROSS WT 1,200 KG']]);

    // Putting the model's values back drops the correction's review and its example.
    await call('POST', `/shipments/${shipment.id}/documents/${documentId}/data/revert`, undefined, user.cookie);
    assert.equal((await call('GET', '/review/queue', undefined, user.cookie)).body.total, 1);
    assert.equal((await call('GET', '/suppliers/examples', undefined, user.cookie)).body.suppliers.length, 0);
  });
});
