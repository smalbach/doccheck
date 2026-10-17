// End-to-end tests of the analytics routes (docs/ANALYTICS.md) against a real Postgres, on their
// own database and port so they run next to e2e.test.mjs. No model is needed: the account history
// is the Data Q&A fixture (shipments of the synthetic set with the rules run on them), and Data Q&A
// is exercised through /analytics/qa/run, which applies the same guard and scope to given SQL.
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Uses DATABASE_URL_ANALYTICS_TEST, else the database of DATABASE_URL_TEST (or doccheck_test) with
// _test replaced by _analytics_test, on port E2E_PORT + 4 (+1 is the orgs suite, +2 the usage and review one, +3 integrations, +7 the portal).
// Each account below is its own personal organization.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const testUrl = (() => {
  if (process.env.DATABASE_URL_ANALYTICS_TEST) return process.env.DATABASE_URL_ANALYTICS_TEST;
  const u = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  const name = process.env.DATABASE_URL_TEST ? u.pathname.slice(1) : 'doccheck_test';
  if (!name.endsWith('_test')) throw new Error(`Refusing to derive a database from "${name}": the test database name must end in _test`);
  u.pathname = `/${name.replace(/_test$/, '_analytics_test')}`;
  return u.toString();
})();
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

const port = Number(process.env.E2E_ANALYTICS_PORT ?? Number(process.env.E2E_PORT ?? 3990) + 4);
const base = `http://localhost:${port}`;
const require = createRequire(import.meta.url);
const { buildFixture } = require(join(root, 'apps/api/dist/insights/qa/fixture.js'));

// The corpus the regulation check reads: two documents copied from data/corpus, edited by the tests.
const corpusDir = mkdtempSync(join(tmpdir(), 'doccheck-regwatch-'));
cpSync(join(root, 'data/corpus/cbsa/cbsa-d1-4-1-en.md'), join(corpusDir, 'cbsa/cbsa-d1-4-1-en.md'), { recursive: true });
cpSync(join(root, 'data/corpus/cbp/cfr-19-149.md'), join(corpusDir, 'cbp/cfr-19-149.md'), { recursive: true });

let api;
let pool;

const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';
const call = async (method, path, body, as) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(as ? { cookie: as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = (() => {
    try {
      return text ? JSON.parse(text) : undefined;
    } catch {
      return text;
    }
  })();
  return { status: res.status, body: json, cookie: sessionCookie(res), headers: res.headers };
};
const signUp = async (email = `${randomUUID()}@example.com`) => {
  const res = await call('POST', '/auth/register', { email, password: 'correct horse battery', name: 'Analytics' });
  assert.equal(res.status, 201);
  const orgId = (await call('GET', '/orgs', undefined, res.cookie)).body.active.id;
  return { cookie: res.cookie, id: res.body.id, orgId };
};

const accounts = {};

before(async () => {
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  if ((await c.query('select 1 from pg_database where datname = $1', [dbName])).rowCount === 0) await c.query(`create database ${dbName}`);
  await c.end();
  pool = new pg.Pool({ connectionString: testUrl });
  await pool.query('drop schema if exists qa cascade; drop schema public cascade; create schema public');
  api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: testUrl,
      REDIS_URL: '',
      S3_ENDPOINT: '',
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-analytics-')),
      ADMIN_EMAILS: 'admin-analytics@example.com',
      LLM_CACHE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-analytics-cache-')),
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
      SMTP_URL: '',
      IMAP_URL: '',
      MAIL_CAPTURE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-analytics-mail-')),
      REG_WATCH_SOURCE: corpusDir,
      REG_WATCH_HOURS: '0',
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-analytics-key-')), 'settings.key'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  accounts.a = await signUp();
  accounts.b = await signUp();
  accounts.admin = await signUp('admin-analytics@example.com');
  const evalDir = join(root, 'data/eval/v1');
  accounts.a.shipments = await buildFixture(pool, { userId: accounts.a.id, orgId: accounts.a.orgId }, evalDir, ['CA-001', 'US-001', 'CA-002', 'US-002', 'CA-003', 'US-003', 'CA-004', 'US-004', 'CA-005', 'US-005', 'CA-006', 'US-006']);
  accounts.b.shipments = await buildFixture(pool, { userId: accounts.b.id, orgId: accounts.b.orgId }, evalDir, ['CA-050', 'US-050']);
});

after(async () => {
  api?.kill();
  await pool?.end();
});

const get = (path, as = accounts.a.cookie) => call('GET', path, undefined, as).then((r) => {
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
  return r.body;
});

describe('KPIs', () => {
  it('counts first-pass results, breakdowns and resolution from the validation history', async () => {
    const k = await get('/analytics/kpis');
    const withFindings = accounts.a.shipments.filter((s) => s.findings > 0).length;
    assert.equal(k.totals.shipments, 12);
    assert.equal(k.totals.cleanFirstPass, 12 - withFindings);
    assert.equal(k.totals.firstPassFindings, accounts.a.shipments.reduce((n, s) => n + s.findings, 0));
    // Every third shipment with findings had its first one corrected in a second run (fixture).
    assert.ok(k.totals.resolvedFindings >= 1);
    assert.equal(k.totals.medianResolutionHours, 12);
    assert.equal(k.months.reduce((n, m) => n + m.shipments, 0), 12);
    const x5 = k.byRule.find((g) => g.key === 'X5');
    assert.ok(x5 && x5.shipments === 12 && x5.withFindings > 0);
    assert.ok(k.byRule.find((g) => g.key === 'X11').shipments === 6, 'X11 runs on the US shipments only');
    assert.ok(k.byDocumentType.some((g) => g.key === 'COMMERCIAL_INVOICE'));
    assert.ok(k.bySupplier.every((g) => g.label));
    assert.ok(k.byOrigin.length > 0 && k.byRoute.every((g) => g.key.includes('→') || g.key === '-'));

    const us = await get('/analytics/kpis?destination=US');
    assert.equal(us.totals.shipments, 6);
    const none = await get('/analytics/kpis?from=2000-01-01&to=2000-12-31');
    assert.equal(none.totals.shipments, 0);
    assert.equal((await call('GET', '/analytics/kpis?from=2026-05-01&to=2026-01-01', undefined, accounts.a.cookie)).status, 400);
    assert.equal((await call('GET', '/analytics/kpis', undefined, '')).status, 401);
    // Another account sees only its own two shipments.
    assert.equal((await get('/analytics/kpis', accounts.b.cookie)).totals.shipments, 2);
  });

  it('exports every breakdown as one CSV', async () => {
    const res = await fetch(`${base}/analytics/kpis.csv?destination=CA`, { headers: { cookie: accounts.a.cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /doccheck-kpis-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = (await res.text()).replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Breakdown,Key,Label,Validated shipments,Shipments with findings on first validation,Findings on first validation,Error rate %');
    assert.ok(lines.some((l) => l.startsWith('rule,X5,')));
    assert.ok(lines.some((l) => l.startsWith('month,')));
  });
});

describe('supplier scorecard', () => {
  it('ranks the sellers with a score and opens one', async () => {
    const list = await get('/analytics/suppliers');
    assert.ok(list.length > 0);
    const ranked = list.filter((s) => s.rank);
    assert.deepEqual(ranked.map((s) => s.rank), ranked.map((_, i) => i + 1));
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score.score >= ranked[i].score.score);
    const top = list[0];
    assert.equal(top.score.components.firstPass, top.cleanFirstPass / top.validatedShipments);
    const detail = await get(`/analytics/suppliers/${top.partyId}`);
    assert.equal(detail.name, top.name);
    assert.ok(Array.isArray(detail.months) && Array.isArray(detail.topRules));
    assert.equal((await call('GET', `/analytics/suppliers/${top.partyId}`, undefined, accounts.b.cookie)).status, 404);
    assert.equal((await call('GET', `/analytics/suppliers/${randomUUID()}`, undefined, accounts.a.cookie)).status, 404);
  });
});

describe('cost avoided', () => {
  it('estimates with the defaults, saves edited assumptions and goes back', async () => {
    const report = await get('/analytics/cost');
    assert.equal(report.defaults, true);
    assert.ok(report.assumptions.penalties.some((p) => p.id === 'cbsa-amps-c005' && p.amount === '150.00'));
    assert.ok(report.items.length > 0);
    for (const i of report.items) assert.match(i.amount, /^\d+\.\d{2}$/);

    const edited = structuredClone(report.assumptions);
    edited.penalties[0].amount = '1000.00';
    edited.delay.days = 0;
    assert.equal((await call('PUT', '/analytics/cost/assumptions', { assumptions: edited }, accounts.a.cookie)).status, 204);
    const after = await get('/analytics/cost');
    assert.equal(after.defaults, false);
    assert.ok(after.items.every((i) => i.item !== 'delay'));
    assert.ok(after.items.filter((i) => i.item === 'cbsa-amps-c005').every((i) => i.amount === '1000.00'));
    // Another account keeps the defaults.
    assert.equal((await get('/analytics/cost', accounts.b.cookie)).defaults, true);

    const bad = structuredClone(edited);
    bad.penalties[0].amount = '12.345';
    assert.equal((await call('PUT', '/analytics/cost/assumptions', { assumptions: bad }, accounts.a.cookie)).status, 400);
    bad.penalties[0].amount = '-5';
    assert.equal((await call('PUT', '/analytics/cost/assumptions', { assumptions: bad }, accounts.a.cookie)).status, 400);
    const dup = structuredClone(edited);
    dup.penalties[1].id = dup.penalties[0].id;
    assert.equal((await call('PUT', '/analytics/cost/assumptions', { assumptions: dup }, accounts.a.cookie)).status, 400);

    assert.equal((await call('DELETE', '/analytics/cost/assumptions', undefined, accounts.a.cookie)).status, 204);
    assert.equal((await get('/analytics/cost')).defaults, true);
  });
});

describe('price benchmark', () => {
  it('groups unit prices per product and per HS-6 and origin, and lists one group', async () => {
    const products = await get('/analytics/prices?by=product');
    assert.ok(products.length > 0);
    for (const g of products) assert.ok(g.stats.n >= 1 && g.currency && /^\d+\.\d{4}$/.test(g.stats.median));
    const hs = await get('/analytics/prices?by=hs6');
    assert.ok(hs.every((g) => g.key === `${g.hs6}:${g.origin ?? ''}`));
    const g = hs[0];
    const detail = await get(`/analytics/prices/group?by=hs6&key=${encodeURIComponent(g.key)}&currency=${g.currency}&unit=${encodeURIComponent(g.unit)}`);
    assert.equal(detail.points.length, g.stats.n);
    assert.equal(detail.points.filter((p) => p.outlier).length, g.outliers);
    assert.equal((await call('GET', `/analytics/prices/group?by=hs6&key=${encodeURIComponent(g.key)}&currency=${g.currency}&unit=${encodeURIComponent(g.unit)}`, undefined, accounts.b.cookie)).status, 404);
  });
});

describe('Data Q&A', () => {
  const run = (sql, as = accounts.a.cookie) => call('POST', '/analytics/qa/run', { sql }, as);

  it('runs a checked query scoped to the account, read-only and with the row cap', async () => {
    const r = await run('select reference from shipments order by reference');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.columns, ['reference']);
    assert.equal(r.body.rows.length, 12);
    assert.equal(r.body.role, true);
    assert.deepEqual((await run('select count(*) from shipments', accounts.b.cookie)).body.rows, [['2']]);
    // Every view is scoped: no row belongs to a shipment of another account.
    for (const view of ['invoices', 'invoice_lines', 'packing_lists', 'bills_of_lading', 'containers', 'isf', 'findings', 'mail_requests']) {
      const r = await run(`select count(*) from ${view} where shipment_id not in (select id from shipments)`);
      assert.deepEqual(r.body.rows, [['0']], view);
      assert.ok(Number((await run(`select count(*) from ${view}`)).body.rows[0][0]) >= 0);
    }
    for (const [view, table] of [['parties', 'parties'], ['products', 'products']]) {
      const n = (await pool.query(`select count(*)::text as n from ${table} where org_id = $1`, [accounts.a.orgId])).rows[0].n;
      assert.deepEqual((await run(`select count(*) from ${view}`)).body.rows, [[n]], view);
    }
    const big = await run('select s.reference from shipments s, invoice_lines l, invoice_lines m');
    assert.equal(big.status, 200);
    assert.equal(big.body.rows.length, 200);
    assert.equal(big.body.truncated, true);
  });

  it('refuses writes, other tables, the catalog and changing the account', async () => {
    for (const sql of [
      'delete from shipments',
      'select * from users',
      'select password_hash from users',
      'select * from public.shipments',
      'select * from pg_user',
      `select set_config('doccheck.qa_org', '${accounts.b.orgId}', true), * from shipments`,
      "select current_setting('doccheck.qa_org')",
      'select 1; drop table shipments',
      'select pg_sleep(5)',
    ]) {
      const r = await run(sql);
      assert.equal(r.status, 400, sql);
      assert.equal(r.body.code, 'sql_rejected', sql);
    }
    const slow = await run('with recursive r (n) as (select 1 union all select n + 1 from r) select count(*) from r');
    assert.equal(slow.status, 400);
    assert.match(slow.body.message, /statement timeout/);
  });

  it('keeps the views empty when the account setting is missing, and the role off the tables', async () => {
    assert.equal((await pool.query('select count(*)::int as n from qa.shipments')).rows[0].n, 0);
    const c = await pool.connect();
    try {
      await c.query('begin read only');
      await c.query('set local role doccheck_qa');
      // Without usage on schema public the tables are not even found.
      await assert.rejects(c.query('select * from public.shipments'), /permission denied/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('regulation changes', () => {
  it('stores a baseline, then reports changed passages with the rules and the open shipments they concern', async () => {
    assert.equal((await call('POST', '/analytics/regulations/check', undefined, accounts.a.cookie)).status, 403);
    const first = await call('POST', '/analytics/regulations/check', undefined, accounts.admin.cookie);
    assert.equal(first.status, 201);
    assert.equal(first.body.baseline, true);
    assert.equal(first.body.documents, 2);
    assert.equal(first.body.changes, 0);

    const file = join(corpusDir, 'cbp/cfr-19-149.md');
    const text = readFileSync(file, 'utf8');
    const passage = text.split('\n\n').find((b) => b.startsWith('(b) Importation.'));
    assert.ok(passage);
    writeFileSync(file, text.replace(passage, `${passage} This sentence was added by the test.`));
    const second = await call('POST', '/analytics/regulations/check', undefined, accounts.admin.cookie);
    assert.equal(second.body.baseline, false);
    assert.equal(second.body.changes, 1);

    const before = await get('/analytics/regulations/unread');
    assert.equal(before.unread, 1);
    const page = await get('/analytics/regulations');
    const [change] = page.changes;
    assert.deepEqual([change.documentId, change.kind, change.after.endsWith('added by the test.'), change.rules], ['cfr-19-149', 'changed', true, [{ destination: 'US', ruleId: 'X11' }, { destination: 'US', ruleId: 'U2' }, { destination: 'US', ruleId: 'U3' }]]);
    // The account's US shipments with open ISF findings (X11, U2, U3) are listed.
    const x11 = (await run2('select distinct s.reference from shipments s join findings f on f.shipment_id = s.id where f.rule_id in (\'X11\', \'U2\', \'U3\') and f.status in (\'open\', \'waiting_supplier\')')).map((r) => r[0]).sort();
    assert.deepEqual(change.affected.map((a) => a.reference).sort(), x11);
    assert.equal((await call('POST', '/analytics/regulations/read', undefined, accounts.a.cookie)).status, 204);
    assert.equal((await get('/analytics/regulations/unread')).unread, 0);
    // Nothing changed: nothing new.
    assert.equal((await call('POST', '/analytics/regulations/check', undefined, accounts.admin.cookie)).body.changes, 0);
  });
});

const run2 = async (sql) => (await call('POST', '/analytics/qa/run', { sql }, accounts.a.cookie)).body.rows;
