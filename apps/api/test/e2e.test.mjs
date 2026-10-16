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
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
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
if (!/_test($|_)/.test(dbName)) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

// Cached model responses replayed by the API (E2E_LLM_CACHE_DIR overrides, e.g. for another model).
const llmCacheDir = process.env.E2E_LLM_CACHE_DIR || join(root, 'eval/cache/ollama_qwen3.8');
// Evaluation reports served by GET /results: a valid one, a truncated one (as while eval-cli writes it)
// and agent reports for two models, the other one newer.
const provider = `ollama:${process.env.LLM_MODEL || 'qwen3.8'}`;
const reportsDir = mkdtempSync(join(tmpdir(), 'doccheck-e2e-reports-'));
const tally = { total: 10, correct: 9, accuracy: 0.9 };
writeFileSync(join(reportsDir, 'extraction-ollama_test.json'), JSON.stringify({ provider, overall: tally, byType: [{ type: 'ISF', ...tally }], byTemplate: [], byField: [], rules: { table: [] } }));
writeFileSync(join(reportsDir, 'extraction-ollama_test-v1-scans.json'), '{"provider": "ollama:');
writeFileSync(join(reportsDir, 'agent-ollama_aaa.json'), JSON.stringify({ provider: 'ollama:other', summary: [] }));
writeFileSync(join(reportsDir, 'agent-ollama_test.json'), JSON.stringify({ provider, summary: [] }));
utimesSync(join(reportsDir, 'agent-ollama_test.json'), new Date(0), new Date(0));

// E2E_PORT lets several checkouts run the suite at once (each with its own DATABASE_URL_TEST).
const port = Number(process.env.E2E_PORT ?? 3990);
// No SMTP: the API writes each email here as JSON (the reset links are read from it).
const mailDir = mkdtempSync(join(tmpdir(), 'doccheck-e2e-mail-'));
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

// Every route but /health and /auth needs a session: the tests run as one user, signed up in before().
let cookie = '';
const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';

/** fetch with the session cookie of `as` (default: the test user). */
const send = (url, init = {}, as = cookie) => fetch(url, { ...init, headers: { ...init.headers, ...(as ? { cookie: as } : {}) } });

const call = async (method, path, body, as = cookie) => {
  const res = await send(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, as);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: sessionCookie(res) };
};

/** Signs up a new user and returns its session cookie. */
const signUp = async (name = 'Test user') => {
  const res = await call('POST', '/auth/register', { email: `${randomUUID()}@example.com`, password: 'correct horse battery', name }, '');
  assert.equal(res.status, 201);
  return res.cookie;
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
      REPORTS_DIR: reportsDir,
      ADMIN_EMAILS: 'admin-e2e@example.com',
      LLM_CACHE_DIR: llmCacheDir,
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
      SMTP_URL: '',
      MAIL_CAPTURE_DIR: mailDir,
      MAIL_FROM: 'DocCheck <docs@doccheck.example>',
      MAIL_OUTBOX_MS: '200',
      MAIL_USER_HOURLY: '8',
      MAIL_INTAKE_MS: '300',
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-e2e-key-')), 'settings.key'),
      MAIL_INBOUND_SECRET: 'inbound-secret',
      IMAP_URL: '',
      APP_URL: 'http://app.example/',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) {
        cookie = await signUp();
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not start');
});

after(async () => {
  api?.kill();
  await pool?.end();
});

// The repository straight from the build, for races an HTTP test cannot time (a slow extraction
// finishing after the user changed the ISF).
let pool;
let repo;
before(async () => {
  const require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { ShipmentsRepository } = require(join(root, 'apps/api/dist/shipments/shipments.repository.js'));
  pool = new pg.Pool({ connectionString: testUrl });
  repo = new ShipmentsRepository(pool);
});

describe('auth', () => {
  it('keeps everything but /health and /auth behind a session', async () => {
    assert.equal((await call('GET', '/health', undefined, '')).status, 200);
    for (const path of ['/shipments', '/rules', '/results', '/demo/samples', '/auth/me']) assert.equal((await call('GET', path, undefined, '')).status, 401, path);
    assert.equal((await call('POST', '/shipments', { destination: 'CA' }, '')).status, 401);
    assert.equal((await call('GET', '/shipments', undefined, 'doccheck_session=forged')).status, 401);
  });

  it('signs up, signs in and out, and never returns the password hash', async () => {
    const email = `${randomUUID()}@Example.com`;
    const reg = await call('POST', '/auth/register', { email, password: 'correct horse battery', name: ' Ada ' }, '');
    assert.equal(reg.status, 201);
    assert.deepEqual(Object.keys(reg.body).sort(), ['createdAt', 'email', 'id', 'name', 'role']);
    assert.equal(reg.body.role, 'user');
    assert.equal(reg.body.email, email.toLowerCase());
    assert.equal(reg.body.name, 'Ada');
    assert.match(reg.cookie, /^doccheck_session=/);

    assert.equal((await call('POST', '/auth/register', { email: email.toUpperCase(), password: 'another password', name: 'Eve' }, '')).status, 409);
    assert.equal((await call('POST', '/auth/register', { email: 'not-an-email', password: 'correct horse battery', name: 'X' }, '')).status, 400);
    assert.equal((await call('POST', '/auth/register', { email: `${randomUUID()}@example.com`, password: 'short', name: 'X' }, '')).status, 400);

    assert.equal((await call('GET', '/auth/me', undefined, reg.cookie)).body.email, email.toLowerCase());
    assert.equal((await call('POST', '/auth/logout', undefined, reg.cookie)).status, 204);
    assert.equal((await call('GET', '/auth/me', undefined, reg.cookie)).status, 401);

    assert.equal((await call('POST', '/auth/login', { email, password: 'wrong password' }, '')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email: `${randomUUID()}@example.com`, password: 'wrong password' }, '')).status, 401);
    const login = await call('POST', '/auth/login', { email, password: 'correct horse battery' }, '');
    assert.equal(login.status, 200);
    assert.equal((await call('GET', '/auth/me', undefined, login.cookie)).body.id, reg.body.id);
  });

  it('updates the profile and changes the password, signing out other sessions', async () => {
    const email = `${randomUUID()}@example.com`;
    const a = (await call('POST', '/auth/register', { email, password: 'first password', name: 'Grace' }, '')).cookie;
    const b = (await call('POST', '/auth/login', { email, password: 'first password' }, '')).cookie;
    assert.equal((await call('PATCH', '/auth/me', { name: 'Grace H.' }, a)).body.name, 'Grace H.');
    assert.equal((await call('POST', '/auth/password', { currentPassword: 'nope', newPassword: 'second password' }, a)).status, 401);
    assert.equal((await call('POST', '/auth/password', { currentPassword: 'first password', newPassword: 'second password' }, a)).status, 204);
    assert.equal((await call('GET', '/auth/me', undefined, a)).status, 200);
    assert.equal((await call('GET', '/auth/me', undefined, b)).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'first password' }, '')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'second password' }, '')).status, 200);
  });

  it('deletes the account with its shipments after checking the password', async () => {
    const email = `${randomUUID()}@example.com`;
    const me = (await call('POST', '/auth/register', { email, password: 'to be deleted', name: 'Leaving' }, '')).cookie;
    const { body: shipment } = await call('POST', '/shipments', { destination: 'CA' }, me);
    assert.equal((await call('DELETE', '/auth/me', { password: 'wrong' }, me)).status, 401);
    const del = await call('DELETE', '/auth/me', { password: 'to be deleted' }, me);
    assert.equal(del.status, 204);
    assert.equal((await call('GET', '/auth/me', undefined, me)).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'to be deleted' }, '')).status, 401);
    assert.equal((await pool.query('select 1 from shipments where id = $1', [shipment.id])).rowCount, 0);
  });

  it('refuses sign-in after 10 failures for an email', async () => {
    const email = `${randomUUID()}@example.com`;
    await call('POST', '/auth/register', { email, password: 'correct horse battery', name: 'Target' }, '');
    for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/auth/login', { email, password: `wrong ${i}` }, '')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'correct horse battery' }, '')).status, 429);
  });

  it('keeps shipments private to their owner', async () => {
    const other = await signUp('Other');
    const { body: mine } = await call('POST', '/shipments', { destination: 'CA', reference: 'mine' });
    assert.ok(!(await call('GET', '/shipments?limit=100', undefined, other)).body.items.some((s) => s.id === mine.id));
    assert.ok((await call('GET', '/shipments?limit=100')).body.items.some((s) => s.id === mine.id));
    assert.equal((await call('PATCH', `/shipments/${mine.id}`, { reference: 'theirs' }, other)).status, 404);
    assert.equal((await call('GET', `/shipments/${mine.id}/validations`, undefined, other)).status, 404);
    for (const [method, path] of [['GET', `/shipments/${mine.id}`], ['GET', `/shipments/${mine.id}/isf`], ['POST', `/shipments/${mine.id}/validate?agent=false`], ['DELETE', `/shipments/${mine.id}`]]) {
      assert.equal((await call(method, path, undefined, other)).status, 404, `${method} ${path}`);
    }
    assert.equal((await call('GET', `/shipments/${mine.id}`)).status, 200);
  });

  it('refuses state-changing requests from another origin', async () => {
    const res = await send(`${base}/shipments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ destination: 'CA' }) });
    assert.equal(res.status, 403);
    const same = await send(`${base}/shipments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ destination: 'CA' }) });
    assert.equal(same.status, 201);
  });
});

/** The emails sent to `to` so far, oldest first. */
const mailsTo = (to) =>
  readdirSync(mailDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(mailDir, f), 'utf8')))
    .filter((m) => m.to === to);

/** Waits for the `count`-th email to `to` (sent after the API answered) and returns it. */
const waitForMail = async (to, count = 1) => {
  for (let i = 0; i < 40; i++) {
    const mails = mailsTo(to);
    if (mails.length >= count) return mails[count - 1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No email #${count} to ${to}`);
};
const tokenOf = (mail) => new URL(mail.text.match(/http\S+/)[0].replace('/#/', '/')).searchParams.get('token');

describe('password reset by email', () => {
  it('answers the same for unknown and known emails, and only mails the known one', async () => {
    const email = `${randomUUID()}@example.com`;
    await call('POST', '/auth/register', { email, password: 'correct horse battery', name: 'Known' }, '');
    const unknownEmail = `${randomUUID()}@example.com`;
    const unknown = await call('POST', '/auth/forgot-password', { email: unknownEmail }, '');
    const known = await call('POST', '/auth/forgot-password', { email: email.toUpperCase() }, '');
    assert.equal(unknown.status, 202);
    assert.equal(known.status, 202);
    assert.deepEqual(unknown.body, known.body);
    assert.equal((await call('POST', '/auth/forgot-password', { email: 'not-an-email' }, '')).status, 400);

    const mail = await waitForMail(email);
    assert.match(mail.subject, /reset/i);
    assert.match(mail.text, /^http:\/\/app\.example\/#\/reset-password\?token=[\w-]{43}$/m);
    assert.ok(mail.html.includes(`token=${tokenOf(mail)}`));
    // The token is stored only as its hash.
    assert.equal((await pool.query('select 1 from password_resets where token_hash = $1', [tokenOf(mail)])).rowCount, 0);
    assert.equal(mailsTo(unknownEmail).length, 0);
  });

  it('resets once, signs out every session and voids the other links', async () => {
    const email = `${randomUUID()}@example.com`;
    const a = (await call('POST', '/auth/register', { email, password: 'old password', name: 'Forgetful' }, '')).cookie;
    const b = (await call('POST', '/auth/login', { email, password: 'old password' }, '')).cookie;
    assert.equal((await call('POST', '/auth/forgot-password', { email }, '')).status, 202);
    const first = tokenOf(await waitForMail(email, 1));
    assert.equal((await call('POST', '/auth/forgot-password', { email }, '')).status, 202);
    const second = tokenOf(await waitForMail(email, 2));

    assert.equal((await call('POST', '/auth/reset-password', { token: second, newPassword: 'short' }, '')).status, 400);
    assert.equal((await call('POST', '/auth/reset-password', { token: second, newPassword: 'new password' }, '')).status, 204);
    assert.equal((await call('POST', '/auth/reset-password', { token: second, newPassword: 'another password' }, '')).status, 400);
    assert.equal((await call('POST', '/auth/reset-password', { token: first, newPassword: 'another password' }, '')).status, 400);

    for (const session of [a, b]) assert.equal((await call('GET', '/auth/me', undefined, session)).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'old password' }, '')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'new password' }, '')).status, 200);
  });

  it('refuses expired and made-up tokens', async () => {
    const email = `${randomUUID()}@example.com`;
    await call('POST', '/auth/register', { email, password: 'old password', name: 'Late' }, '');
    await call('POST', '/auth/forgot-password', { email }, '');
    const token = tokenOf(await waitForMail(email));
    await pool.query("update password_resets set expires_at = now() - interval '1 minute' where user_id = (select id from users where email = $1)", [email]);
    const expired = await call('POST', '/auth/reset-password', { token, newPassword: 'new password' }, '');
    assert.equal(expired.status, 400);
    assert.match(expired.body.message, /reset link/);
    assert.equal((await call('POST', '/auth/reset-password', { token: 'made-up', newPassword: 'new password' }, '')).status, 400);
    assert.equal((await call('POST', '/auth/reset-password', { newPassword: 'new password' }, '')).status, 400);
    assert.equal((await call('POST', '/auth/login', { email, password: 'old password' }, '')).status, 200);
  });

  it('limits requests per email (whether it exists or not) and per address', async () => {
    const email = `${randomUUID()}@example.com`;
    for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/forgot-password', { email }, '')).status, 202);
    assert.equal((await call('POST', '/auth/forgot-password', { email }, '')).status, 429);

    const { ResetThrottle } = createRequire(import.meta.url)(join(root, 'apps/api/dist/auth/reset-throttle.js'));
    const throttle = new ResetThrottle();
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      assert.equal(throttle.retryAfter(`${i}@example.com`, '203.0.113.7', now), 0);
      throttle.record(`${i}@example.com`, '203.0.113.7', now);
    }
    assert.ok(throttle.retryAfter('new@example.com', '203.0.113.7', now) > 0);
    assert.equal(throttle.retryAfter('new@example.com', '198.51.100.1', now), 0);
    assert.equal(throttle.retryAfter('new@example.com', '203.0.113.7', now + 16 * 60 * 1000), 0);
  });

  it('works in the read-only demo', () => {
    const { readOnlyGuard } = createRequire(import.meta.url)(join(root, 'apps/api/dist/demo/demo-mode.js'));
    const run = (method, path) => {
      let status = 0;
      let passed = false;
      const res = { status: (s) => ((status = s), res), json: () => res };
      readOnlyGuard({ method, path }, res, () => (passed = true));
      return passed ? 'next' : status;
    };
    assert.equal(run('POST', '/auth/forgot-password'), 'next');
    assert.equal(run('POST', '/auth/reset-password'), 'next');
    assert.equal(run('POST', '/shipments'), 403);
  });
});

describe('admin', () => {
  let admin;
  before(async () => {
    const res = await call('POST', '/auth/register', { email: 'Admin-E2E@example.com', password: 'admin password', name: 'Admin' }, '');
    assert.equal(res.status, 201);
    assert.equal(res.body.role, 'admin');
    admin = res.cookie;
  });

  it('is closed to visitors and to users who are not admins', async () => {
    assert.equal((await call('GET', '/auth/me')).body.role, 'user');
    for (const [method, path] of [['GET', '/admin/settings'], ['PUT', '/admin/settings'], ['GET', '/admin/users'], ['GET', '/admin/system'], ['GET', '/admin/models']]) {
      assert.equal((await call(method, path, method === 'PUT' ? { ocrScale: 3 } : undefined)).status, 403, `${method} ${path}`);
      assert.equal((await call(method, path, method === 'PUT' ? { ocrScale: 3 } : undefined, '')).status, 401, `${method} ${path} signed out`);
    }
  });

  it('changes settings, validates them and resets them to .env', async () => {
    const list = (await call('GET', '/admin/settings', undefined, admin)).body;
    assert.deepEqual(list.settings.map((x) => x.key), ['llmModel', 'agentEnabled', 'registrationOpen', 'ocrEngine', 'ocrUrl', 'ocrLanguages', 'ocrScale', 'ocrPsm']);
    assert.equal(list.editable, true);
    assert.equal(list.settings.find((x) => x.key === 'agentEnabled').source, 'env');

    const saved = (await call('PUT', '/admin/settings', { ocrScale: 5, ocrPsm: '11', agentEnabled: true }, admin)).body;
    const scale = saved.settings.find((x) => x.key === 'ocrScale');
    assert.equal(scale.value, 5);
    assert.equal(scale.source, 'admin');
    assert.equal(scale.updatedBy, 'admin-e2e@example.com');

    for (const bad of [{ ocrScale: 9 }, { ocrScale: '4' }, { ocrPsm: '99' }, { ocrLanguages: [] }, { ocrLanguages: ['xyz'] }, { nope: 1 }, {}, { llmModel: 'bad model name!' }]) {
      assert.equal((await call('PUT', '/admin/settings', bad, admin)).status, 400, JSON.stringify(bad));
    }
    // A well-formed name Ollama does not have: refused (400), or 503 when Ollama is not running here.
    assert.ok([400, 503].includes((await call('PUT', '/admin/settings', { llmModel: 'not-installed-model' }, admin)).status));
    // A refused batch saves nothing.
    assert.equal((await call('PUT', '/admin/settings', { ocrScale: 3, ocrPsm: '99' }, admin)).status, 400);
    assert.equal((await call('GET', '/admin/settings', undefined, admin)).body.settings.find((x) => x.key === 'ocrScale').value, 5);

    // Unlimited-OCR needs its server to answer: nothing listens on port 9 (discard).
    const down = await call('PUT', '/admin/settings', { ocrEngine: 'unlimited', ocrUrl: 'http://127.0.0.1:9' }, admin);
    assert.equal(down.status, 503);
    assert.match(down.body.message, /does not answer/);
    assert.equal((await call('PUT', '/admin/settings', { ocrUrl: 'ftp://x' }, admin)).status, 400);
    const url = (await call('PUT', '/admin/settings', { ocrUrl: 'http://127.0.0.1:9/' }, admin)).body; // tesseract stays: the URL is not checked
    assert.deepEqual([url.settings.find((x) => x.key === 'ocrUrl').value, url.ocrServer], ['http://127.0.0.1:9/', undefined]);
    assert.equal(process.env.OCR_ENGINE ?? 'tesseract', 'tesseract');
    assert.deepEqual(url.options.ocrEngines, ['tesseract', 'unlimited']);
    assert.equal((await call('DELETE', '/admin/settings/ocrUrl', undefined, admin)).status, 200);
    for (const key of ['ocrScale', 'ocrPsm', 'agentEnabled']) assert.equal((await call('DELETE', `/admin/settings/${key}`, undefined, admin)).status, 200);
    const reset = (await call('GET', '/admin/settings', undefined, admin)).body.settings;
    assert.equal(reset.find((x) => x.key === 'ocrScale').source, 'default');
    assert.equal(reset.find((x) => x.key === 'agentEnabled').value, false);
    assert.equal((await call('DELETE', '/admin/settings/nope', undefined, admin)).status, 400);
  });

  it('closes and reopens registration; admins listed in ADMIN_EMAILS can always sign up', async () => {
    assert.equal((await call('GET', '/health', undefined, '')).body.registrationOpen, true);
    assert.equal((await call('PUT', '/admin/settings', { registrationOpen: false }, admin)).status, 200);
    assert.equal((await call('GET', '/health', undefined, '')).body.registrationOpen, false);
    assert.equal((await call('POST', '/auth/register', { email: `${randomUUID()}@example.com`, password: 'closed for now', name: 'Late' }, '')).status, 403);
    // The admin address is not refused for being closed (it already exists, hence 409).
    assert.equal((await call('POST', '/auth/register', { email: 'admin-e2e@example.com', password: 'admin password', name: 'Admin' }, '')).status, 409);
    // Signing in still works.
    assert.equal((await call('POST', '/auth/login', { email: 'admin-e2e@example.com', password: 'admin password' }, '')).status, 200);
    assert.equal((await call('DELETE', '/admin/settings/registrationOpen', undefined, admin)).status, 200);
    assert.equal((await call('POST', '/auth/register', { email: `${randomUUID()}@example.com`, password: 'open again', name: 'Early' }, '')).status, 201);
  });

  it('limits sign-ups per address, not counting this machine', () => {
    const { SignupThrottle } = createRequire(import.meta.url)(join(root, 'apps/api/dist/auth/signup-throttle.js'));
    const throttle = new SignupThrottle();
    const before = process.env.SIGNUP_LIMIT_PER_HOUR;
    process.env.SIGNUP_LIMIT_PER_HOUR = '2';
    try {
      const now = Date.now();
      for (let i = 0; i < 2; i++) {
        assert.equal(throttle.retryAfter('203.0.113.7', now), 0);
        throttle.record('203.0.113.7', now);
      }
      assert.ok(throttle.retryAfter('203.0.113.7', now) > 0);
      assert.equal(throttle.retryAfter('198.51.100.1', now), 0);
      assert.equal(throttle.retryAfter('203.0.113.7', now + 61 * 60 * 1000), 0);
      for (let i = 0; i < 5; i++) throttle.record('127.0.0.1', now);
      assert.equal(throttle.retryAfter('127.0.0.1', now), 0);
      assert.equal(throttle.retryAfter('::1', now), 0);
    } finally {
      if (before === undefined) delete process.env.SIGNUP_LIMIT_PER_HOUR;
      else process.env.SIGNUP_LIMIT_PER_HOUR = before;
    }
  });

  it('manages roles without locking anyone out', async () => {
    const me = (await call('GET', '/auth/me', undefined, admin)).body;
    const other = await signUp('Promoted');
    const otherId = (await call('GET', '/auth/me', undefined, other)).body.id;
    assert.equal((await call('PATCH', `/admin/users/${me.id}`, { role: 'user' }, admin)).status, 400);
    assert.equal((await call('PATCH', `/admin/users/${otherId}`, { role: 'owner' }, admin)).status, 400);
    assert.equal((await call('PATCH', `/admin/users/${randomUUID()}`, { role: 'admin' }, admin)).status, 404);
    const users = (await call('PATCH', `/admin/users/${otherId}`, { role: 'admin' }, admin)).body;
    assert.equal(users.find((u) => u.id === otherId).role, 'admin');
    assert.equal((await call('GET', '/admin/users', undefined, other)).status, 200);
    // The new admin can demote the first one, then nobody can demote the last.
    assert.equal((await call('PATCH', `/admin/users/${me.id}`, { role: 'user' }, other)).status, 200);
    assert.equal((await call('GET', '/admin/users', undefined, admin)).status, 403);
    assert.equal((await call('PATCH', `/admin/users/${me.id}`, { role: 'admin' }, other)).status, 200);
  });

  it('lets an admin reset another user\'s password, signing them out', async () => {
    const email = `${randomUUID()}@example.com`;
    const userCookie = (await call('POST', '/auth/register', { email, password: 'forgotten password', name: 'Forgetful' }, '')).cookie;
    const userId = (await call('GET', '/auth/me', undefined, userCookie)).body.id;
    const adminId = (await call('GET', '/auth/me', undefined, admin)).body.id;
    assert.equal((await call('POST', `/admin/users/${userId}/password`, { newPassword: 'brand new password' }, userCookie)).status, 403);
    assert.equal((await call('POST', `/admin/users/${adminId}/password`, { newPassword: 'brand new password' }, admin)).status, 400);
    assert.equal((await call('POST', `/admin/users/${userId}/password`, { newPassword: 'short' }, admin)).status, 400);
    assert.equal((await call('POST', `/admin/users/${randomUUID()}/password`, { newPassword: 'brand new password' }, admin)).status, 404);
    assert.equal((await call('POST', `/admin/users/${userId}/password`, { newPassword: 'brand new password' }, admin)).status, 204);
    assert.equal((await call('GET', '/auth/me', undefined, userCookie)).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'forgotten password' }, '')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email, password: 'brand new password' }, '')).status, 200);
  });

  it('reports the system status', async () => {
    const sys = (await call('GET', '/admin/system', undefined, admin)).body;
    for (const key of ['demo', 'ollama', 'model', 'embeddings', 'queue', 'storage', 'cache', 'ocr', 'agentEnabled', 'counts']) assert.ok(key in sys, key);
    assert.equal(sys.queue, 'in-process');
    assert.ok(sys.counts.users >= 2);
    const models = (await call('GET', '/admin/models', undefined, admin)).body;
    assert.equal(typeof models.reachable, 'boolean');
  });
});

describe('shipments', () => {
  it('reports health with the database', async () => {
    const { body } = await call('GET', '/health');
    assert.equal(body.database, 'ok');
  });

  it('creates, lists and rejects unknown shipments', async () => {
    const created = await call('POST', '/shipments', { reference: 'E2E-1', destination: 'CA' });
    assert.equal(created.status, 201);
    const list = await call('GET', '/shipments?q=E2E-1');
    assert.ok(list.body.items.some((s) => s.id === created.body.id && s.documentCount === 0 && s.findingCount === null));
    assert.equal((await call('GET', '/shipments?limit=500')).status, 400);
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

  it('pages, filters and counts the list on the server', async () => {
    const user = await signUp('Pager');
    const made = [];
    for (const [reference, destination] of [['PG-a', 'CA'], ['PG-b', 'US'], ['PG-c', 'CA'], ['PG_%', 'CA']]) {
      made.push((await call('POST', '/shipments', { reference, destination }, user)).body);
      await new Promise((r) => setTimeout(r, 5)); // created_at has millisecond precision: keep the order unambiguous
    }
    await call('POST', `/shipments/${made[0].id}/validate?agent=false`, { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading }, user);
    const page = (q) => call('GET', `/shipments?${q}`, undefined, user).then((r) => r.body);

    const first = await page('limit=2');
    assert.equal(first.total, 4);
    assert.deepEqual(first.items.map((s) => s.reference), ['PG_%', 'PG-c']);
    assert.deepEqual((await page('limit=2&offset=2')).items.map((s) => s.reference), ['PG-b', 'PG-a']);
    const past = await page('limit=2&offset=10');
    assert.deepEqual([past.items.length, past.total], [0, 4]);

    assert.deepEqual((await page('destination=US')).items.map((s) => s.reference), ['PG-b']);
    assert.deepEqual((await page('q=pg_')).items.map((s) => s.reference), ['PG_%']); // _ and % are literal
    assert.deepEqual((await page('status=done')).items.map((s) => s.reference), ['PG-a']);
    assert.deepEqual((await page('status=open')).total, 3);
    assert.deepEqual(first.summary, { all: 4, open: 3, attention: 0, done: 1, findings: 0, waiting: 0, overdue: 0, dueSoon: 0 });
  });

  it('edits a shipment and keeps every validation run as history', async () => {
    const { body: s } = await call('POST', '/shipments', { reference: 'Old', destination: 'CA' });
    const docs = { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading };
    const bl = { ...sampleBillOfLading, totalPackages: 121 };
    const one = (await call('POST', `/shipments/${s.id}/validate?agent=false`, { ...docs, billOfLading: bl })).body;
    const two = (await call('POST', `/shipments/${s.id}/validate?agent=false`, docs)).body;

    const history = (await call('GET', `/shipments/${s.id}/validations`)).body;
    assert.deepEqual(history.map((v) => v.id), [two.validationId, one.validationId]);
    assert.deepEqual([history[1].findings, history[1].destination, history[0].findings], [1, 'CA', 0]);
    const past = (await call('GET', `/shipments/${s.id}/validations/${one.validationId}`)).body;
    assert.deepEqual(past.findings.map((f) => f.ruleId), ['X2']);
    assert.equal((await call('GET', `/shipments/${s.id}/validations/${randomUUID()}`)).status, 404);

    const edited = await call('PATCH', `/shipments/${s.id}`, { reference: 'New', destination: 'US', transportMode: 'AIR' });
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.body.reference, edited.body.destination, edited.body.transportMode], ['New', 'US', 'AIR']);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { reference: '' })).body.reference, undefined);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, {})).status, 400);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { status: 'DONE' })).status, 400);
    assert.equal((await call('GET', `/shipments/${s.id}/validation`)).body.destination, 'CA'); // the run keeps its own

    await repo.insertDocument({ id: randomUUID(), shipmentId: s.id, fileName: 'x.pdf', storageKey: 'none', sha256: '0', status: 'QUEUED' });
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { destination: 'CA' })).status, 409);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { reference: 'Still editable' })).status, 200);
  });

  it('deletes a shipment with its validation and findings', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    await call('POST', `/shipments/${s.id}/validate?agent=false`, { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading });
    assert.equal((await call('DELETE', `/shipments/${s.id}`)).status, 204);
    assert.equal((await call('GET', `/shipments/${s.id}`)).status, 404);
    assert.equal((await call('GET', `/shipments/${s.id}/findings`)).status, 404);
    assert.equal((await call('DELETE', `/shipments/${s.id}`)).status, 404);
  });

  it('serves evaluation results, skipping unreadable reports, with the agent report of the app model', async () => {
    const { status, body } = await call('GET', '/results');
    assert.equal(status, 200);
    assert.deepEqual(body.extraction.map((r) => r.file), ['extraction-ollama_test.json']);
    assert.equal(body.agent.provider, provider);
  });

  it('refuses to delete a shipment while a document is extracting', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    await repo.insertDocument({ id: randomUUID(), shipmentId: s.id, fileName: 'x.pdf', storageKey: 'none', sha256: '0', status: 'QUEUED' });
    assert.equal((await call('DELETE', `/shipments/${s.id}`)).status, 409);
    assert.equal((await call('GET', `/shipments/${s.id}`)).status, 200);
  });

  it('requires a destination before validating', async () => {
    const { body: s } = await call('POST', '/shipments', {});
    assert.equal((await call('POST', `/shipments/${s.id}/validate`)).status, 400);
  });

  it('rejects an upload that is not a PDF', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const form = new FormData();
    form.append('files', new Blob(['hello'], { type: 'application/pdf' }), 'fake.pdf');
    const res = await send(`${base}/shipments/${s.id}/documents`, { method: 'POST', body: form });
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

  it('read from a PDF does not overwrite an ISF saved or deleted while the PDF was extracting', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'US' });
    const extract = async (since) => {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId: s.id, fileName: 'isf.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      const extraction = { documentId: id, documentType: 'ISF', model: 'test', promptVersion: 'test', raw: {}, data: isf, issues: [], pdfLines: [] };
      const doc = { pageCount: 1, detectedType: 'ISF', typeConfidence: 1 };
      const { isfSaved } = await repo.saveExtraction(id, doc, extraction, { shipmentId: s.id, data: { ...isf, countryOfOrigin: 'VN' }, since });
      const issues = (await call('GET', `/shipments/${s.id}/documents/${id}`)).body.issues;
      return { id, isfSaved, issues };
    };

    // No ISF when the job started, none now: the PDF's is stored.
    const first = await extract(null);
    assert.equal(first.isfSaved, true);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).body.documentId, first.id);

    // Unchanged since the job started: replaced.
    const second = await extract(await repo.isfVersion(s.id));
    assert.equal(second.isfSaved, true);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).body.documentId, second.id);

    // A JSON filing saved during the extraction wins, and the document says why its ISF was not used.
    const since = await repo.isfVersion(s.id);
    await call('PUT', `/shipments/${s.id}/isf`, isf);
    const late = await extract(since);
    assert.equal(late.isfSaved, false);
    assert.ok(late.issues.some((i) => i.includes('changed while this PDF was being extracted')));
    const kept = (await call('GET', `/shipments/${s.id}/isf`)).body;
    assert.equal(kept.source, 'upload');
    assert.equal(kept.data.countryOfOrigin, 'CN');

    // Deleted during the extraction (or another PDF stored first): it does not come back.
    const before = await repo.isfVersion(s.id);
    await call('DELETE', `/shipments/${s.id}/isf`);
    assert.equal((await extract(before)).isfSaved, false);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).status, 404);
  });

  it('entered by hand blocks leaving the US; one read from a PDF goes and comes back with the destination', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'US' });
    await call('PUT', `/shipments/${s.id}/isf`, isf);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { destination: 'CA' })).status, 409);
    await call('DELETE', `/shipments/${s.id}/isf`);

    const id = randomUUID();
    await repo.insertDocument({ id, shipmentId: s.id, fileName: 'isf.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(
      id,
      { pageCount: 1, detectedType: 'ISF', typeConfidence: 1 },
      { documentId: id, documentType: 'ISF', model: 'test', promptVersion: 'test', raw: {}, data: isf, issues: [], pdfLines: [] },
      { shipmentId: s.id, data: isf, since: null },
    );
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { destination: 'CA' })).status, 200);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).status, 404);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { destination: 'US' })).status, 200);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).body.documentId, id);
  });

  it('read from two PDFs is the newest upload, whatever order they finish in, and falls back to the other', async () => {
    const upload = async (shipmentId) => {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId, fileName: `${id}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      return id;
    };
    const finish = (shipmentId, id, countryOfOrigin, since = null) =>
      repo.saveExtraction(
        id,
        { pageCount: 1, detectedType: 'ISF', typeConfidence: 1 },
        { documentId: id, documentType: 'ISF', model: 'test', promptVersion: 'test', raw: {}, data: { ...isf, countryOfOrigin }, issues: [], pdfLines: [] },
        { shipmentId, data: { ...isf, countryOfOrigin }, since },
      );
    const stored = async (shipmentId) => (await call('GET', `/shipments/${shipmentId}/isf`)).body;

    // Newer upload finishes first: the older one, finishing later, does not replace it.
    const { body: s1 } = await call('POST', '/shipments', { destination: 'US' });
    const older1 = await upload(s1.id);
    const newer1 = await upload(s1.id);
    assert.equal((await finish(s1.id, newer1, 'VN')).isfSaved, true);
    assert.equal((await finish(s1.id, older1, 'CN')).isfSaved, false);
    assert.equal((await stored(s1.id)).documentId, newer1);

    // Older upload finishes first: the newer one replaces it, though the ISF changed since it started.
    const { body: s2 } = await call('POST', '/shipments', { destination: 'US' });
    const older2 = await upload(s2.id);
    const newer2 = await upload(s2.id);
    assert.equal((await finish(s2.id, older2, 'CN')).isfSaved, true);
    assert.equal((await finish(s2.id, newer2, 'VN')).isfSaved, true);
    assert.equal((await stored(s2.id)).documentId, newer2);

    // The newer one turns out not to be an ISF: the older PDF's ISF comes back.
    await repo.deleteIsfFromDocument(newer2);
    const back = await stored(s2.id);
    assert.equal(back.documentId, older2);
    assert.equal(back.data.countryOfOrigin, 'CN');
  });

  it('is rejected when invalid or for a Canadian shipment', async () => {
    const { body: us } = await call('POST', '/shipments', { destination: 'US' });
    assert.equal((await call('PUT', `/shipments/${us.id}/isf`, { seller: 1 })).status, 400);
    const { body: ca } = await call('POST', '/shipments', { destination: 'CA' });
    assert.equal((await call('PUT', `/shipments/${ca.id}/isf`, isf)).status, 400);
  });
});

/**
 * Opens a server-sent events stream with the session of `as` and collects its messages in the
 * background. `events()` are the progress events, `ready()` resolves on the `ready` message (backlog
 * sent), `waitFor(fn)` once fn(events) is true.
 */
async function openStream(path, { as = cookie, lastEventId } = {}) {
  const ctrl = new AbortController();
  const res = await send(base + path, { headers: lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }, signal: ctrl.signal }, as);
  const messages = [];
  let notify = () => {};
  const changed = () => new Promise((r) => (notify = r));
  if (res.ok) {
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const msg = {};
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) msg.comment = true;
              const [, field, value] = /^(\w+): ?(.*)$/.exec(line) ?? [];
              if (field) msg[field] = value;
            }
            messages.push(msg);
          }
          notify();
        }
      } catch {}
      notify();
    })();
  } else await res.body?.cancel();
  const events = () => messages.filter((m) => m.data && !m.event).map((m) => JSON.parse(m.data));
  const waitFor = async (fn, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (!fn(events(), messages)) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting on ${path}; got ${JSON.stringify(events().map((e) => `${e.stage}:${e.status}`))}`);
      await Promise.race([changed(), new Promise((r) => setTimeout(r, 100))]);
    }
    return events();
  };
  return { res, messages, events, waitFor, ready: () => waitFor((_, m) => m.some((x) => x.event === 'ready')), close: () => ctrl.abort() };
}

const savedDone = (runId) => (events) => events.some((e) => e.runId === runId && e.stage === 'saved' && e.status === 'done');
const docs = () => ({ invoice: sampleInvoice, packingList: samplePackingList, billOfLading: { ...sampleBillOfLading, totalPackages: 121 } });

describe('progress events', () => {
  it('streams the stages of a validation live, in order, with the validation id as run id', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const stream = await openStream(`/shipments/${s.id}/events`);
    assert.equal(stream.res.status, 200);
    assert.match(stream.res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(stream.res.headers.get('x-accel-buffering'), 'no');
    await stream.ready();
    assert.deepEqual(stream.events(), []);

    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs());
    assert.equal(run.status, 200);
    const events = await stream.waitFor(savedDone(run.body.validationId));
    stream.close();

    assert.ok(events.every((e) => e.kind === 'validation' && e.runId === run.body.validationId && e.shipmentId === s.id && !e.documentId));
    assert.deepEqual(events.map((e) => e.id), [...events.map((e) => e.id)].sort((a, b) => a - b));
    const stages = events.filter((e) => e.status !== 'progress').map((e) => `${e.stage}:${e.status}`);
    assert.equal(stages[0], 'started:started');
    assert.deepEqual(stages.slice(1, 3), ['rules:started', 'rules:done']);
    assert.match(stages[3], /^citations:started$/);
    assert.match(stages[4], /^citations:(done|skipped|failed)$/); // failed when no embedding model is reachable
    assert.deepEqual(stages.slice(5), ['agent:skipped', 'saved:started', 'saved:done']);
    assert.deepEqual(events.find((e) => e.stage === 'started').detail, { agent: false, destination: 'CA' });
    assert.equal(events.find((e) => e.stage === 'agent').detail.reason, 'disabled');

    const rules = events.filter((e) => e.stage === 'rules' && e.status === 'progress');
    assert.equal(rules.length, run.body.ran.length + run.body.skipped.length);
    assert.deepEqual(rules.map((e) => e.detail.index), rules.map((_, i) => i + 1));
    assert.equal(rules.find((e) => e.detail.rule === 'X2').detail.findings, 1);
    assert.deepEqual(events.find((e) => e.stage === 'rules' && e.status === 'started').detail, { documents: 3 });
    // Each rule's findings come with it, under the id the stored finding keeps.
    const [x2] = run.body.findings;
    assert.deepEqual(rules.find((e) => e.detail.rule === 'X2').detail.found, [{ id: x2.id, severity: x2.severity, message: x2.message }]);
    assert.ok(rules.filter((e) => e.detail.rule !== 'X2').every((e) => e.detail.found === undefined));
    const stored = await call('GET', `/shipments/${s.id}/validation`);
    assert.deepEqual(stored.body.findings.map((f) => f.id), [x2.id]);
    // One citation event per finding that got a regulation quote, naming the finding.
    assert.deepEqual(events.find((e) => e.stage === 'citations' && e.status === 'started').detail, { findings: 1 });
    const cited = events.filter((e) => e.stage === 'citations' && e.status === 'progress');
    assert.deepEqual(cited.map((e) => e.detail.findingId), run.body.findings.filter((f) => f.regulation).map((f) => f.id));
    assert.ok(cited.every((e) => typeof e.detail.title === 'string' && e.detail.title.length <= 120));
    const done = events.find((e) => e.stage === 'rules' && e.status === 'done');
    assert.deepEqual(done.detail, { ran: run.body.ran.length, skipped: run.body.skipped.length, total: rules.length, findings: 1 });
    assert.equal(typeof done.durationMs, 'number');
    assert.deepEqual(events.at(-1).detail, { validationId: run.body.validationId, findings: 1, skipped: 0, agent: 'skipped' });
    assert.ok(events.every((e) => !Number.isNaN(Date.parse(e.at))));
  });

  it('replays what a client missed after Last-Event-ID or ?after=, and the latest run without either', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const first = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs());
    const second = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs());

    const all = await openStream(`/shipments/${s.id}/events?after=0`);
    const events = await all.waitFor(savedDone(second.body.validationId));
    all.close();
    assert.deepEqual([...new Set(events.map((e) => e.runId))], [first.body.validationId, second.body.validationId]);

    const cut = events[4].id;
    const resumed = await openStream(`/shipments/${s.id}/events`, { lastEventId: cut });
    await resumed.ready();
    resumed.close();
    assert.deepEqual(resumed.events().map((e) => e.id), events.filter((e) => e.id > cut).map((e) => e.id));
    // The SSE id of each message is the event id, which EventSource sends back as Last-Event-ID.
    assert.deepEqual(resumed.messages.filter((m) => m.id).map((m) => Number(m.id)), resumed.events().map((e) => e.id));

    const after = await openStream(`/shipments/${s.id}/events?after=${cut}`);
    await after.ready();
    after.close();
    assert.deepEqual(after.events().map((e) => e.id), resumed.events().map((e) => e.id));

    const fresh = await openStream(`/shipments/${s.id}/events`);
    await fresh.ready();
    fresh.close();
    assert.deepEqual([...new Set(fresh.events().map((e) => e.runId))], [second.body.validationId]);
  });

  it('answers 404 to another user and 401 without a session', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const other = await signUp('Stranger');
    assert.equal((await openStream(`/shipments/${s.id}/events`, { as: other })).res.status, 404);
    assert.equal((await openStream('/shipments/00000000-0000-0000-0000-000000000000/events')).res.status, 404);
    assert.equal((await openStream(`/shipments/${s.id}/events`, { as: '' })).res.status, 401);
    assert.equal((await openStream('/events', { as: '' })).res.status, 401);
  });

  it('streams every shipment of the user on /events, and only theirs', async () => {
    const other = await signUp('Neighbour');
    const mine = (await call('POST', '/shipments', { destination: 'CA' })).body;
    const theirs = (await call('POST', '/shipments', { destination: 'CA' }, other)).body;
    const myStream = await openStream('/events');
    const theirStream = await openStream('/events', { as: other });
    await Promise.all([myStream.ready(), theirStream.ready()]);

    const a = await call('POST', `/shipments/${theirs.id}/validate?agent=false`, docs(), other);
    const b = await call('POST', `/shipments/${mine.id}/validate?agent=false`, docs());
    await myStream.waitFor(savedDone(b.body.validationId));
    await theirStream.waitFor(savedDone(a.body.validationId));
    myStream.close();
    theirStream.close();
    const live = (stream, ready) => stream.events().filter((e) => e.id > ready);
    const readyId = (stream) => JSON.parse(stream.messages.find((m) => m.event === 'ready').data).lastId;
    assert.deepEqual([...new Set(live(theirStream, readyId(theirStream)).map((e) => e.shipmentId))], [theirs.id]);
    assert.ok(live(myStream, readyId(myStream)).every((e) => e.shipmentId !== theirs.id));
    assert.ok(myStream.events().some((e) => e.shipmentId === mine.id));
    assert.ok(theirStream.events().every((e) => e.userId === theirStream.events()[0].userId));
  });
});

/** A one-page PDF with a text layer (no OCR needed), for extractions that never reach a real model. */
function textPdf(lines) {
  const content = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td', ...lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Cancelling extractions. The API under test extracts in-process from cached answers, which is too
// fast to cancel; the running case uses a worker built here from the API's own classes (as a BullMQ
// worker in another process would be), whose model never answers until the call is aborted. The API
// reaches it through NOTIFY, as it would reach a real worker.
describe('cancel extraction', () => {
  let progress;
  let processor;
  /** Model calls the worker's model received, and whether each was aborted. */
  const calls = [];
  before(async () => {
    const require = createRequire(import.meta.url);
    const dist = (p) => require(join(root, 'apps/api/dist', p));
    const { ProgressRepository } = dist('progress/progress.repository.js');
    const { ProgressService } = dist('progress/progress.service.js');
    const { DocumentProcessor } = dist('shipments/document.processor.js');
    const { LlmClient } = await import('@doccheck/extraction');
    // The listener connects with DATABASE_URL.
    process.env.DATABASE_URL = testUrl;
    process.env.DEMO_PACING = 'false';
    progress = new ProgressService(new ProgressRepository(pool));
    await progress.onApplicationBootstrap();
    const llm = new LlmClient({
      id: 'fake:never',
      generate: (req) =>
        new Promise((_, reject) => {
          const call = { aborted: false };
          calls.push(call);
          req.signal?.addEventListener('abort', () => {
            call.aborted = true;
            reject(req.signal.reason);
          });
        }),
    });
    const pdf = textPdf(['PACKING LIST PL-1', 'Invoice INV-1   Total packages 10 CTN']);
    processor = new DocumentProcessor(repo, { get: async () => pdf }, llm, progress, new ProgressRepository(pool));
  });
  after(async () => {
    await progress?.beforeApplicationShutdown();
  });

  /** A shipment with one QUEUED document whose run has started (`queued`), as an upload leaves it. */
  const queuedDocument = async (as = cookie) => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA', reference: 'Cancel me' }, as);
    const id = randomUUID();
    await repo.insertDocument({ id, shipmentId: s.id, fileName: 'packing-list.pdf', storageKey: `${s.id}/${id}.pdf`, sha256: '0', status: 'QUEUED' });
    const runId = randomUUID();
    const queuedAt = Date.now();
    await progress.run('extraction', s.id, { documentId: id, runId }).emit({ stage: 'queued', status: 'started', detail: { position: 1 } });
    await progress.flush();
    return { shipmentId: s.id, documentId: id, runId, queuedAt };
  };
  const cancelPath = (d) => `/shipments/${d.shipmentId}/documents/${d.documentId}/cancel`;

  it('takes a queued document out of the line: FAILED, its run ends, and no worker extracts it', async () => {
    const d = await queuedDocument();
    const res = await call('POST', cancelPath(d));
    assert.equal(res.status, 200);
    assert.equal(res.body.document.status, 'FAILED');
    assert.equal(res.body.document.error, 'Cancelled by the user');

    const stream = await openStream(`/shipments/${d.shipmentId}/events`);
    await stream.ready();
    stream.close();
    const events = stream.events().filter((e) => e.documentId === d.documentId);
    assert.deepEqual(
      events.map((e) => `${e.stage}:${e.status}`),
      ['queued:started', 'queued:failed', 'saved:failed'],
    );
    assert.ok(events.every((e) => e.runId === d.runId));
    assert.deepEqual(events.at(-1).detail, { error: 'Cancelled by the user', reason: 'cancelled' });

    // The job was already handed to a worker: it finds the document cancelled and leaves it.
    await processor.process(d.documentId, undefined, { runId: d.runId, queuedAt: d.queuedAt });
    assert.equal((await repo.findDocument(d.documentId)).status, 'FAILED');
    assert.equal(calls.length, 0);
    // Nothing left to cancel.
    assert.equal((await call('POST', cancelPath(d))).status, 409);
    assert.equal((await call('GET', `/shipments/${d.shipmentId}`)).body.status, 'RECEIVED');
  });

  it('stops a running extraction in another process: the model call is aborted, the document ends FAILED, no retry', async () => {
    const d = await queuedDocument();
    const stream = await openStream(`/shipments/${d.shipmentId}/events`);
    await stream.ready();
    const running = processor.process(d.documentId, 'PACKING_LIST', { runId: d.runId, queuedAt: d.queuedAt, willRetry: true });
    const outcome = running.then(
      () => 'resolved',
      (err) => err,
    );
    await stream.waitFor((events) => events.some((e) => e.documentId === d.documentId && e.stage === 'extracting' && e.status === 'started'));
    assert.equal((await repo.findDocument(d.documentId)).status, 'EXTRACTING');

    const res = await call('POST', cancelPath(d));
    assert.equal(res.status, 200);
    const err = await outcome;
    assert.equal(err.message, 'Cancelled by the user');
    assert.equal(err.constructor.name, 'ExtractionCancelledError');
    assert.equal(calls.at(-1).aborted, true);
    const doc = await repo.findDocument(d.documentId);
    assert.equal(doc.status, 'FAILED');
    assert.equal(doc.error, 'Cancelled by the user');

    await stream.waitFor((events) => events.some((e) => e.documentId === d.documentId && e.stage === 'saved' && e.status === 'failed'));
    stream.close();
    const events = stream.events().filter((e) => e.documentId === d.documentId && e.status !== 'progress');
    assert.deepEqual(
      events.map((e) => `${e.stage}:${e.status}`),
      ['queued:started', 'queued:done', 'reading:started', 'reading:done', 'classifying:skipped', 'extracting:started', 'extracting:failed', 'saved:failed'],
    );
    assert.equal(events.find((e) => e.stage === 'extracting' && e.status === 'failed').detail.error, 'Cancelled by the user');
    // willRetry was set (a first attempt), but a cancelled extraction is not retried.
    assert.deepEqual(events.at(-1).detail, { error: 'Cancelled by the user', reason: 'cancelled' });
  });

  it('stops an extraction while the model streams its answer: no delta after the cancel', async () => {
    // An Ollama that streams the start of an answer, then keeps writing a piece every 100 ms forever.
    const { createServer } = await import('node:http');
    const { LlmClient, OllamaProvider } = await import('@doccheck/extraction');
    const { ProgressRepository } = createRequire(import.meta.url)(join(root, 'apps/api/dist/progress/progress.repository.js'));
    const { DocumentProcessor } = createRequire(import.meta.url)(join(root, 'apps/api/dist/shipments/document.processor.js'));
    let chatRequests = 0;
    let chatClosed = false;
    const ollama = createServer((req, res) => {
      if (req.url === '/api/tags') return void res.end(JSON.stringify({ models: [] }));
      chatRequests += 1;
      const body = [];
      req.on('data', (c) => body.push(c));
      req.on('end', () => assert.equal(JSON.parse(Buffer.concat(body).toString()).stream, true));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const line = (content) => res.write(JSON.stringify({ message: { content }, done: false }) + '\n');
      line('{"packingListNumber": "PL-1", "invoiceRef": "');
      const timer = setInterval(() => line('x'), 100);
      res.on('close', () => {
        chatClosed = true;
        clearInterval(timer);
      });
    });
    await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
    try {
      const llm = new LlmClient(new OllamaProvider('stream-test', `http://127.0.0.1:${ollama.address().port}`));
      const streaming = new DocumentProcessor(repo, { get: async () => textPdf(['PACKING LIST PL-1', 'Invoice INV-1   Total packages 10 CTN']) }, llm, progress, new ProgressRepository(pool));
      const d = await queuedDocument();
      const stream = await openStream(`/shipments/${d.shipmentId}/events`);
      await stream.ready();
      const outcome = streaming.process(d.documentId, 'PACKING_LIST', { runId: d.runId, queuedAt: d.queuedAt }).then(
        () => 'resolved',
        (err) => err,
      );
      // The answer is being written: deltas arrive on the shipment stream.
      await stream.waitFor((events) => events.filter((e) => e.documentId === d.documentId && e.ephemeral).length >= 2);

      const res = await call('POST', cancelPath(d));
      assert.equal(res.status, 200);
      const err = await outcome;
      assert.equal(err.message, 'Cancelled by the user');
      assert.equal(chatRequests, 1);
      const doc = await repo.findDocument(d.documentId);
      assert.equal(doc.status, 'FAILED');
      assert.equal(doc.error, 'Cancelled by the user');

      await stream.waitFor((events) => events.some((e) => e.documentId === d.documentId && e.stage === 'saved' && e.status === 'failed'));
      // Long enough for a few more pieces, had the model call gone on.
      await new Promise((r) => setTimeout(r, 600));
      stream.close();
      assert.ok(chatClosed, 'the streaming request to the model was dropped');
      const events = stream.events().filter((e) => e.documentId === d.documentId);
      const failedAt = events.findIndex((e) => e.stage === 'extracting' && e.status === 'failed');
      assert.ok(failedAt > 0);
      assert.equal(events[failedAt].detail.error, 'Cancelled by the user');
      assert.ok(events.slice(0, failedAt).some((e) => e.ephemeral));
      assert.deepEqual(events.slice(failedAt).filter((e) => e.ephemeral), [], 'no delta after the cancel');
      assert.deepEqual(
        events.filter((e) => !e.ephemeral && e.status !== 'progress').map((e) => `${e.stage}:${e.status}`),
        ['queued:started', 'queued:done', 'reading:started', 'reading:done', 'classifying:skipped', 'extracting:started', 'extracting:failed', 'saved:failed'],
      );
      assert.deepEqual(events.at(-1).detail, { error: 'Cancelled by the user', reason: 'cancelled' });
    } finally {
      ollama.closeAllConnections();
      ollama.close();
    }
  });

  it('is limited to the owner and to documents being extracted', async () => {
    const d = await queuedDocument();
    const other = await signUp('Not the owner');
    assert.equal((await call('POST', cancelPath(d), undefined, other)).status, 404);
    assert.equal((await call('POST', cancelPath(d), undefined, '')).status, 401);
    assert.equal((await call('POST', `/shipments/${d.shipmentId}/documents/${randomUUID()}/cancel`)).status, 404);
    assert.equal((await repo.findDocument(d.documentId)).status, 'QUEUED');
    // Read-only demo: blocked like every other write.
    const { readOnlyGuard } = createRequire(import.meta.url)(join(root, 'apps/api/dist/demo/demo-mode.js'));
    let status;
    readOnlyGuard({ method: 'POST', path: cancelPath(d) }, { status: (s) => ((status = s), { json: () => undefined }) }, () => (status = 'next'));
    assert.equal(status, 403);
    await call('POST', cancelPath(d));
  });
});

describe('activity', () => {
  it('opens /events with every run still going and the 10 latest finished ones', async () => {
    const user = await signUp('Busy');
    const { body: s } = await call('POST', '/shipments', { destination: 'CA', reference: 'ACT-1' }, user);
    // A validation that never ends (its process died), started before the finished ones.
    const stuck = randomUUID();
    await pool.query(
      `insert into progress_events (shipment_id, user_id, run_id, kind, stage, status, detail) values ($1, (select user_id from shipments where id = $1), $2, 'validation', 'started', 'started', '{}')`,
      [s.id, stuck],
    );
    const finished = [];
    for (let i = 0; i < 11; i++) {
      const v = await call('POST', `/shipments/${s.id}/validate?agent=false`, docs(), user);
      assert.equal(v.status, 200);
      finished.push(v.body.validationId);
    }
    // Events are stored in the background: wait for the last run's end.
    const last = await openStream(`/shipments/${s.id}/events`, { as: user });
    await last.waitFor(savedDone(finished.at(-1)));
    last.close();
    const stream = await openStream('/events', { as: user });
    await stream.ready();
    stream.close();
    const runs = [...new Set(stream.events().map((e) => e.runId))];
    assert.ok(runs.includes(stuck));
    assert.equal(runs.length, 11);
    assert.deepEqual(runs.filter((r) => r !== stuck).sort(), finished.slice(1).sort());
    // Whole runs: each starts with its first event.
    for (const runId of finished.slice(1)) assert.equal(stream.events().find((e) => e.runId === runId).stage, 'started');
  });

  it('names only the user\'s own shipments and documents', async () => {
    const user = await signUp('Labels');
    const { body: s } = await call('POST', '/shipments', { destination: 'US', reference: 'LBL-7' }, user);
    const docId = randomUUID();
    await repo.insertDocument({ id: docId, shipmentId: s.id, fileName: 'invoice.pdf', storageKey: 'none', sha256: '0', status: 'QUEUED' });
    const path = `/events/labels?shipments=${s.id},not-a-uuid&documents=${docId}`;
    const mine = await call('GET', path, undefined, user);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body, { shipments: [{ id: s.id, reference: 'LBL-7', destination: 'US' }], documents: [{ id: docId, shipmentId: s.id, fileName: 'invoice.pdf', status: 'QUEUED' }] });
    assert.deepEqual((await call('GET', path)).body, { shipments: [], documents: [] });
    assert.equal((await call('GET', path, undefined, '')).status, 401);
  });

  it('estimates stage durations from history, per model, without user data', async () => {
    // Model calls of a model only seen here: 1 s, 2 s and 9 s (median 2 s), plus a cached one.
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    for (const [ms, cached] of [[1000, false], [2000, false], [9000, false], [5, true]]) {
      await pool.query(
        `insert into progress_events (shipment_id, user_id, run_id, kind, stage, status, duration_ms, detail) values ($1, null, $2, 'extraction', 'extracting', 'done', $3, $4)`,
        [s.id, randomUUID(), ms, JSON.stringify({ model: 'fake:estimates', cached })],
      );
    }
    const res = await call('GET', '/events/estimates');
    assert.equal(res.status, 200);
    assert.equal(res.body.model, provider);
    assert.deepEqual(res.body.models['fake:estimates'], { ms: 2000, samples: 3 });
    // Validations ran above: their stages have history.
    assert.ok(res.body.validation.rules.samples > 0);
    assert.ok(res.body.validation.rules.ms >= 0);
    assert.ok(!Number.isNaN(Date.parse(res.body.computedAt)));
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(s.id) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'no ids');
    assert.equal((await call('GET', '/events/estimates', undefined, '')).status, 401);
  });
});

// PDF path: only when the evaluation set and the cached model responses for CA-001 exist locally.
const sample = join(root, 'data/eval/v1/CA-001');
const hasSample = existsSync(join(sample, 'invoice.pdf')) && existsSync(llmCacheDir);
describe('PDF upload', { skip: !hasSample && 'evaluation set not generated' }, () => {
  it('extracts uploaded PDFs, cites the page and serves the file', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const form = new FormData();
    for (const f of ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf']) form.append('files', new Blob([readFileSync(join(sample, f))], { type: 'application/pdf' }), f);
    const up = await send(`${base}/shipments/${s.id}/documents?wait=true`, { method: 'POST', body: form });
    assert.equal(up.status, 202);
    const { documents } = await up.json();
    assert.deepEqual(documents.map((d) => d.document.status), ['EXTRACTED', 'EXTRACTED', 'EXTRACTED']);

    // Every document's extraction was streamed, stage by stage, ending with saved.
    const stream = await openStream(`/shipments/${s.id}/events`);
    await stream.ready();
    stream.close();
    for (const { document: d } of documents) {
      const events = stream.events().filter((e) => e.documentId === d.id);
      assert.ok(events.every((e) => e.kind === 'extraction' && e.runId === events[0].runId));
      assert.deepEqual(
        events.filter((e) => e.status !== 'progress').map((e) => `${e.stage}:${e.status}`),
        ['queued', 'queued', 'reading', 'reading', 'classifying', 'classifying', 'extracting', 'extracting', 'normalizing', 'normalizing', 'saved', 'saved'].map((stage, i) => `${stage}:${i % 2 ? 'done' : 'started'}`),
      );
      assert.equal(events[0].detail.position > 0, true);
      assert.deepEqual(events.find((e) => e.stage === 'extracting' && e.status === 'started').detail, { model: provider, documentType: d.detectedType });
      assert.equal(events.find((e) => e.stage === 'extracting' && e.status === 'done').detail.cached, true);
      assert.deepEqual(events.at(-1).detail, { documentType: d.detectedType, normalized: true, pages: 1 });
    }

    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`);
    const expected = JSON.parse(readFileSync(join(sample, 'labels.json'), 'utf8')).errors.flatMap((e) => e.expectedRuleIds).sort();
    assert.deepEqual([...new Set(run.body.findings.map((f) => f.ruleId))].sort(), expected);
    assert.ok(run.body.findings.every((f) => f.evidence.some((e) => e.source?.page === 1)));

    const invoiceId = documents[0].document.id;
    const again = await send(`${base}/shipments/${s.id}/documents/${invoiceId}/reextract?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'COMMERCIAL_INVOICE' }) });
    assert.equal(again.status, 202);
    assert.deepEqual([(await again.json()).document.status, (await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body.document.typeConfidence], ['EXTRACTED', 1]);
    assert.equal((await call('POST', `/shipments/${s.id}/documents/${invoiceId}/reextract`, { type: 'UNKNOWN' })).status, 400);

    const file = await send(`${base}/shipments/${s.id}/documents/${documents[0].document.id}/file`);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.equal((await file.arrayBuffer()).byteLength, readFileSync(join(sample, 'invoice.pdf')).length);
  });

  it('streams the model answer live while extracting, without storing it or changing the result', async () => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' });
    const stream = await openStream(`/shipments/${s.id}/events`);
    const everything = await openStream('/events');
    await Promise.all([stream.ready(), everything.ready()]);
    const form = new FormData();
    form.append('files', new Blob([readFileSync(join(sample, 'invoice.pdf'))], { type: 'application/pdf' }), 'invoice.pdf');
    const up = await send(`${base}/shipments/${s.id}/documents?wait=true`, { method: 'POST', body: form });
    const [{ document: d }] = (await up.json()).documents;
    assert.equal(d.status, 'EXTRACTED');
    await stream.waitFor((events) => events.some((e) => e.documentId === d.id && e.stage === 'saved' && e.status === 'done'));
    stream.close();
    everything.close();

    // Deltas: ephemeral, sent without an SSE id, inside the extracting stage, adding up to the stored answer.
    const events = stream.events().filter((e) => e.documentId === d.id);
    const deltas = events.filter((e) => e.ephemeral);
    assert.ok(deltas.length > 0);
    assert.ok(deltas.every((e) => e.id === 0 && e.stage === 'extracting' && e.status === 'progress'));
    assert.ok(stream.messages.filter((m) => m.data && JSON.parse(m.data).ephemeral).every((m) => m.id === undefined));
    const index = (pred) => events.findIndex(pred);
    assert.ok(index((e) => e.stage === 'extracting' && e.status === 'started') < index((e) => e.ephemeral));
    assert.ok(events.findLastIndex((e) => e.ephemeral) < index((e) => e.stage === 'extracting' && e.status === 'done'));
    assert.deepEqual(deltas.map((e) => e.detail.offset), deltas.map((_, i) => deltas.slice(0, i).reduce((n, e) => n + e.detail.delta.length, 0)));
    const stored = (await call('GET', `/shipments/${s.id}/documents/${d.id}`)).body;
    assert.deepEqual(JSON.parse(deltas.map((e) => e.detail.delta).join('')), stored.raw);
    assert.equal(deltas.at(-1).detail.replay, true);
    assert.equal(deltas.at(-1).detail.tokens, stored.outputTokens);

    // Not stored: a new stream's backlog has the stages but no delta; the user-wide stream never had any.
    const later = await openStream(`/shipments/${s.id}/events`);
    await later.ready();
    later.close();
    assert.ok(later.events().some((e) => e.documentId === d.id && e.stage === 'extracting'));
    assert.ok(later.events().every((e) => !e.ephemeral));
    assert.ok(everything.events().every((e) => !e.ephemeral));
  });
});

// ISF as a PDF: only when data/eval/v1-isf (npm run synth -- --isf-pdfs) and a cached model response
// for one of its filings exist. Prefers a filing that disagrees with the invoice, so X11 has a finding.
const isfDir = join(root, 'data/eval/v1-isf');
const isfSample = await (async () => {
  if (!existsSync(isfDir) || !existsSync(llmCacheDir)) return undefined;
  const { readPdfText, extractionRequest, LlmClient, OllamaProvider, PROMPT_VERSION } = await import('@doccheck/extraction');
  // Only the provider id matters for the cache key; nothing is sent to Ollama.
  const llm = new LlmClient(new OllamaProvider('qwen3.8'), llmCacheDir, 'replay');
  const ids = readdirSync(isfDir).filter((id) => existsSync(join(isfDir, id, 'isf.pdf')));
  const withX11 = (id) => JSON.parse(readFileSync(join(isfDir, id, 'labels.json'), 'utf8')).errors.some((e) => e.document === 'isf' && e.expectedRuleIds.includes('X11'));
  for (const id of [...ids.filter(withX11), ...ids.filter((id) => !withX11(id))]) {
    const pdf = await readPdfText(readFileSync(join(isfDir, id, 'isf.pdf')));
    if (await llm.isCached(PROMPT_VERSION, extractionRequest(pdf, 'ISF'))) return join(isfDir, id);
  }
  return undefined;
})();

describe('insights', () => {
  /** A shipment of `user` with the three documents extracted as given. */
  const shipmentWith = async (user, destination, docs) => {
    const { body: s } = await call('POST', '/shipments', { destination, reference: `Insights ${destination}` }, user);
    for (const [type, data] of Object.entries(docs)) {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId: s.id, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
    }
    return s;
  };

  it('sums values, weights and lines across the user\'s shipments, and lists them', async () => {
    const user = await signUp('Insights');
    const docs = { COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: sampleBillOfLading };
    const ca = await shipmentWith(user, 'CA', docs);
    const second = { ...sampleInvoice, invoiceNumber: 'INV-2', currency: 'CAD', lines: [{ ...sampleInvoice.lines[0], description: 'Wooden puzzle', countryOfOrigin: 'VN', hsCode: '9503.00.0090', lineTotal: { amount: '100.50', currency: 'CAD' } }] };
    await shipmentWith(user, 'US', { COMMERCIAL_INVOICE: second });
    await shipmentWith(await signUp('Someone else'), 'CA', docs);
    const get = (path) => call('GET', path, undefined, user).then((r) => r.body);

    const summary = await get('/insights/summary');
    assert.equal(summary.shipments, 2);
    assert.equal(summary.invoiceLines, sampleInvoice.lines.length + 1);
    assert.deepEqual(summary.valueByCurrency, [{ key: 'USD', amount: '48600.00' }, { key: 'CAD', amount: '100.50' }]);
    assert.equal(Number(summary.grossKg), 2500); // the bill of lading's, then the second shipment's invoice (it has no other document)
    assert.equal(summary.containers, 1);
    assert.deepEqual(summary.byHsCode.map((g) => [g.hsCode, g.lines]), [['950300', 2]]);
    assert.deepEqual((await get('/insights/summary?destination=US')).valueByCurrency, [{ key: 'CAD', amount: '100.50' }]);

    const lines = await get('/insights/lines?origin=VN');
    assert.deepEqual(lines.items.map((l) => [l.description, l.invoiceNumber, l.lineTotal.amount]), [['Wooden puzzle', 'INV-2', '100.50']]);
    assert.equal((await get('/insights/lines?hs=9503.00')).total, 2);
    assert.equal((await get('/insights/lines?q=puzzle')).total, 1);
    assert.equal((await call('GET', '/insights/lines?hs=abc', undefined, user)).status, 400);

    const ships = await get(`/insights/shipments?q=${encodeURIComponent(sampleBillOfLading.containers[0].number)}`);
    assert.deepEqual(ships.items.map((s) => s.shipmentId), [ca.id]);
    assert.deepEqual([ships.items[0].packages, ships.items[0].blNumber, ships.items[0].containers], [120, sampleBillOfLading.blNumber, ['CSQU3054383']]);
    assert.equal((await call('GET', '/insights/summary', undefined, '')).status, 401);
  });

  it('exports the goods and the shipments as CSV, with the filters, escaped and without formulas', async () => {
    const user = await signUp('CSV');
    const tricky = {
      ...sampleInvoice,
      invoiceNumber: '=HYPERLINK("x")',
      seller: { ...sampleInvoice.seller, name: 'Acme, "Toys"\nLtd' },
      lines: [
        { ...sampleInvoice.lines[0], description: 'Café crème', countryOfOrigin: 'VN', sku: '+SKU-1', lineTotal: { amount: '-10.50', currency: 'EUR' } },
        { ...sampleInvoice.lines[0], lineNo: 2, description: '@cmd', countryOfOrigin: 'CN' },
      ],
    };
    const ca = await shipmentWith(user, 'CA', { COMMERCIAL_INVOICE: tricky, BILL_OF_LADING: sampleBillOfLading });
    await shipmentWith(user, 'US', { COMMERCIAL_INVOICE: sampleInvoice });
    await shipmentWith(await signUp('Someone else'), 'CA', { COMMERCIAL_INVOICE: tricky });
    const csv = async (path) => {
      const res = await send(base + path, {}, user);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // the UTF-8 BOM
      return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).slice(1), disposition: res.headers.get('content-disposition') };
    };

    const goods = await csv('/insights/lines.csv?destination=CA&origin=VN&limit=1');
    assert.match(goods.disposition, /^attachment; filename="doccheck-goods-\d{4}-\d{2}-\d{2}\.csv"$/);
    const rows = goods.text.split('\r\n');
    assert.equal(rows[0], 'Shipment reference,Shipment ID,Destination,Invoice number,Seller,Line no,SKU,Description,HS code,Country of origin,Quantity,Unit,Unit price,Currency,Line total');
    assert.equal(rows.at(-1), '');
    assert.equal(rows.length, 3); // the header, the one VN line of this user's CA shipment, the final line break
    const line = sampleInvoice.lines[0];
    assert.equal(
      rows[1],
      `Insights CA,${ca.id},CA,"'=HYPERLINK(""x"")","Acme, ""Toys""\nLtd"` +
        `,${line.lineNo},'+SKU-1,Café crème,${line.hsCode},VN,${line.quantity.value},${line.quantity.unit},${line.unitPrice.amount},EUR,-10.50`,
    );
    const all = await csv('/insights/lines.csv');
    assert.equal(all.text.trimEnd().split('\r\n').length, 1 + tricky.lines.length + sampleInvoice.lines.length);
    assert.match(all.text, /,'@cmd,/);
    assert.equal((await csv('/insights/lines.csv?q=nothing-matches')).text, rows[0] + '\r\n');

    const ships = await csv(`/insights/shipments.csv?q=${encodeURIComponent(sampleBillOfLading.blNumber)}`);
    assert.match(ships.disposition, /filename="doccheck-shipments-\d{4}-\d{2}-\d{2}\.csv"/);
    // The seller's own line break stays inside its quoted cell: rows end with CRLF only.
    const [header, ship, ...rest] = ships.text.trimEnd().split('\r\n');
    assert.equal(header, 'Shipment reference,Shipment ID,Destination,Invoice number,Invoice date,Seller,Buyer,Incoterm,Invoice total,Currency,Lines,Packages,Gross kg,Net kg,Volume m3,B/L number,Carrier,Vessel,Port of loading,Port of discharge,Containers');
    assert.ok(ship.startsWith(`Insights CA,${ca.id},CA,"'=HYPERLINK(""x"")",`));
    assert.ok(ship.endsWith(',CSQU3054383'));
    assert.deepEqual(rest, []);
    assert.equal((await csv('/insights/shipments.csv?destination=US')).text.trimEnd().split('\r\n').length, 2);

    assert.equal((await call('GET', '/insights/lines.csv?hs=abc', undefined, user)).status, 400);
    assert.equal((await send(`${base}/insights/lines.csv`, {}, '')).status, 401);
    assert.equal((await send(`${base}/insights/shipments.csv`, {}, '')).status, 401);
  });

  it('projects the extracted data to tables, following corrections, re-extraction and deletion', async () => {
    const user = await signUp('Tables');
    const docs = { COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: sampleBillOfLading };
    const a = await shipmentWith(user, 'CA', docs);
    // Another spelling of the same seller, and the same SKU: one party, one product.
    const respelled = { ...sampleInvoice, seller: { ...sampleInvoice.seller, name: 'ACME TOYS CO LTD' }, discounts: [{ description: 'Early payment', amount: { amount: '100.00', currency: 'USD' } }] };
    const b = await shipmentWith(user, 'US', { COMMERCIAL_INVOICE: respelled });
    const one = async (sql, args) => (await pool.query(sql, args)).rows[0];

    const inv = await one('select * from invoices where shipment_id = $1', [a.id]);
    assert.deepEqual(
      [inv.invoice_number, inv.currency, inv.line_count, inv.lines_total, inv.gross_kg, inv.incoterm, inv.place_of_shipment_locode, inv.extra],
      [sampleInvoice.invoiceNumber, 'USD', 1, '48600.00', '1250', 'FOB', 'CNYTN', null],
    );
    const line = await one('select * from invoice_lines where document_id = $1', [inv.document_id]);
    assert.deepEqual([line.sku, line.quantity, line.unit_price, line.computed_total, line.hs6, line.hs4], ['TB-200', '6000', '8.10', '48600.00', '950300', '9503']);

    const sellers = await pool.query("select distinct party_id from document_parties where user_id = (select user_id from shipments where id = $1) and role in ('seller', 'shipper')", [a.id]);
    assert.equal(sellers.rowCount, 1);
    const products = await pool.query('select distinct product_id from invoice_lines where shipment_id in ($1, $2)', [a.id, b.id]);
    assert.equal(products.rowCount, 1);
    assert.equal((await one('select count(*)::int as n from packing_contents where shipment_id = $1 and product_id = $2', [a.id, products.rows[0].product_id])).n, 1);
    assert.deepEqual((await pool.query('select kind, amount from invoice_adjustments where shipment_id = $1', [b.id])).rows, [{ kind: 'discount', amount: '100.00' }]);

    const bl = await one('select * from bills_of_lading where shipment_id = $1', [a.id]);
    assert.deepEqual([bl.bl_number, bl.container_count, bl.total_packages], [sampleBillOfLading.blNumber, 1, 120]);
    assert.deepEqual(await one('select container_number, owner_code, size_type from bl_containers where document_id = $1', [bl.document_id]), { container_number: 'CSQU3054383', owner_code: 'CSQU', size_type: '40HC' });
    assert.ok((await one('select count(*)::int as n from packing_packages where shipment_id = $1', [a.id])).n > 0);

    // A correction is projected; while the document extracts again it has no rows; then they are back.
    const patched = await call('PATCH', `/shipments/${a.id}/documents/${inv.document_id}/data`, { changes: [{ path: '/lines/0/description', value: 'Teddy bear' }] }, user);
    assert.equal(patched.status, 200);
    assert.equal((await one('select description from invoice_lines where document_id = $1', [inv.document_id])).description, 'Teddy bear');
    await repo.updateDocumentStatus(inv.document_id, 'EXTRACTING');
    assert.equal(await one('select 1 from invoices where document_id = $1', [inv.document_id]), undefined);
    await repo.updateDocumentStatus(inv.document_id, 'EXTRACTED');
    assert.equal((await one('select description from invoice_lines where document_id = $1', [inv.document_id])).description, 'Teddy bear');

    assert.equal((await call('DELETE', `/shipments/${a.id}`, undefined, user)).status, 204);
    for (const table of ['invoices', 'invoice_lines', 'packing_lists', 'bills_of_lading', 'bl_containers', 'document_parties']) {
      assert.equal((await one(`select count(*)::int as n from ${table} where shipment_id = $1`, [a.id])).n, 0, table);
    }
  });

  it('groups companies and products across shipments, with a price history', async () => {
    const user = await signUp('Entities');
    const get = (path, who = user) => call('GET', path, undefined, who);
    await shipmentWith(user, 'CA', { COMMERCIAL_INVOICE: sampleInvoice, BILL_OF_LADING: sampleBillOfLading });
    const later = {
      ...sampleInvoice,
      invoiceNumber: 'INV-LATER',
      invoiceDate: '2026-11-02',
      seller: { ...sampleInvoice.seller, name: 'ACME TOYS CO LTD' },
      lines: [{ ...sampleInvoice.lines[0], quantity: { value: '100', unit: 'PCS' }, unitPrice: { amount: '9.00', currency: 'USD' }, lineTotal: { amount: '900.00', currency: 'USD' } }],
    };
    await shipmentWith(user, 'US', { COMMERCIAL_INVOICE: later });

    const suppliers = (await get('/insights/parties?role=supplier')).body;
    assert.equal(suppliers.total, 1);
    const acme = suppliers.items[0];
    assert.deepEqual([acme.shipments, acme.invoices, acme.lines, acme.products, acme.firstDate, acme.lastDate], [2, 2, 2, 1, '2026-10-01', '2026-11-02']);
    assert.deepEqual(acme.roles, ['seller', 'shipper']);
    assert.deepEqual(acme.names, ['ACME TOYS CO LTD', sampleInvoice.seller.name]);
    assert.deepEqual(acme.values, [{ key: 'USD', amount: '49500.00' }]);
    assert.deepEqual((await get('/insights/parties?role=customer')).body.items.map((p) => p.name), [sampleInvoice.buyer.name]);
    assert.equal((await get('/insights/parties?q=acme%20toys%20co%20ltd')).body.total, 1);
    assert.equal((await get('/insights/parties?destination=US&role=supplier')).body.items[0].shipments, 1);

    const detail = (await get(`/insights/parties/${acme.id}`)).body;
    assert.deepEqual(detail.topProducts.map((p) => [p.sku, p.lines]), [['TB-200', 2]]);
    assert.deepEqual(detail.recentShipments.map((s) => s.invoiceNumber), ['INV-LATER', sampleInvoice.invoiceNumber]);
    assert.deepEqual(detail.addresses.map((x) => [x.name, x.city, x.roles]).sort(), [['ACME TOYS CO LTD', 'Shenzhen', ['seller']], [sampleInvoice.seller.name, 'Shenzhen', ['seller', 'shipper']]]);
    assert.deepEqual(detail.related.map((r) => [r.name, r.roles]), [[sampleInvoice.buyer.name, ['buyer', 'consignee']]]);
    assert.equal((await get(`/insights/lines?party=${acme.id}`)).body.total, 2);
    assert.equal((await get(`/insights/lines?party=${acme.id}&destination=US`)).body.total, 1);

    const products = (await get('/insights/products')).body;
    assert.equal(products.total, 1);
    const bear = products.items[0];
    assert.deepEqual([bear.sku, bear.lines, bear.shipments, bear.sellers, bear.lastSeller, bear.lastDate], ['TB-200', 2, 2, 1, 'ACME TOYS CO LTD', '2026-11-02']);
    // avg is weighted by quantity: (6000 × 8.10 + 100 × 9.00) / 6100
    assert.deepEqual(bear.prices, [{ currency: 'USD', min: '8.10', max: '9.00', avg: '8.1148', last: '9.00' }]);
    assert.deepEqual(bear.quantities, [{ key: 'PCS', amount: '6100' }]);
    assert.equal((await get('/insights/products?q=nothing')).body.total, 0);
    assert.equal((await get('/insights/products?hs=9503')).body.total, 1);

    const history = (await get(`/insights/products/${bear.id}`)).body.history;
    const full = (await get(`/insights/products/${bear.id}`)).body;
    assert.deepEqual(full.bySeller.map((x) => [x.name, x.lines, x.prices[0].avg]), [['ACME TOYS CO LTD', 2, '8.1148']]);
    assert.deepEqual(full.descriptions, [{ text: sampleInvoice.lines[0].description, lines: 2 }]);
    assert.deepEqual(full.origins, [{ country: 'CN', lines: 2 }]);
    assert.equal((await get(`/insights/lines?product=${bear.id}`)).body.total, 2);
    const boxes = (await get('/insights/containers?q=CSQU')).body;
    assert.deepEqual(boxes.items.map((c) => [c.number, c.ownerCode, c.sizeType, c.blNumber, c.packages]), [['CSQU3054383', 'CSQU', '40HC', sampleBillOfLading.blNumber, 120]]);
    assert.equal((await get('/insights/containers?destination=US')).body.total, 0);
    assert.deepEqual(history.map((h) => [h.invoiceDate, h.unitPrice.amount, h.seller]), [['2026-10-01', '8.10', sampleInvoice.seller.name], ['2026-11-02', '9.00', 'ACME TOYS CO LTD']]);

    const other = await signUp('Not theirs');
    assert.equal((await get(`/insights/parties/${acme.id}`, other)).status, 404);
    assert.equal((await get(`/insights/products/${bear.id}`, other)).status, 404);
    assert.equal((await get('/insights/products/not-a-uuid')).status, 400);
    assert.equal((await get('/insights/parties?role=boss')).status, 400);
  });
});

describe('alerts', () => {
  const OCR = 'Read with OCR (page 1, confidence 81%): check values against the scan';
  const tick = () => new Promise((r) => setTimeout(r, 5)); // timestamps decide "after the latest run"

  /** An extracted invoice of the shipment, read with OCR when `ocr` is set. */
  const extracted = async (shipmentId, { ocr = false, fileName = 'invoice.pdf' } = {}) => {
    const id = randomUUID();
    await repo.insertDocument({ id, shipmentId, fileName, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(id, { pageCount: 1, detectedType: 'COMMERCIAL_INVOICE', typeConfidence: 1 }, { documentId: id, documentType: 'COMMERCIAL_INVOICE', model: 'test', promptVersion: 'test', raw: {}, data: sampleInvoice, issues: ocr ? [OCR] : [], pdfLines: [] });
    await tick();
    return id;
  };

  /** A validation run of the shipment with findings of the given severities, each citing `documentId`. */
  const validated = async (shipmentId, severities = [], { documentId = 'body', destination = 'CA' } = {}) => {
    const findings = severities.map((severity, n) => ({
      id: `${shipmentId}:T:${n}`, shipmentId, ruleId: 'T', severity, decidedBy: 'RULE', message: 'test', evidence: [{ documentId, field: 'x', value: '1' }],
    }));
    await repo.saveValidation({ id: randomUUID(), shipmentId, ran: ['T'], skipped: [], inputs: {}, findings, destination });
    await tick();
  };

  it('lists what needs attention on the user\'s shipments only, newest first, with counts per kind', async () => {
    const user = await signUp('Alerts');
    const create = async (reference, destination = 'CA') => (await call('POST', '/shipments', { reference, destination }, user)).body;
    const get = () => call('GET', '/shipments/alerts', undefined, user);
    assert.deepEqual((await get()).body, { items: [], counts: { critical: 0, 'failed-document': 0, ocr: 0, 'not-validated': 0, 'stale-destination': 0, 'mail-reply': 0, 'mail-overdue': 0, 'mail-failed': 0, 'mail-intake': 0 }, total: 0 });

    // critical: the latest run has CRITICAL or HIGH findings; an earlier run's do not count.
    const critical = await create('AL-critical');
    await extracted(critical.id);
    await validated(critical.id, ['CRITICAL', 'CRITICAL']);
    await validated(critical.id, ['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM']);
    const calm = await create('AL-calm');
    await extracted(calm.id);
    await validated(calm.id, ['MEDIUM', 'LOW']);

    // failed-document
    const failed = await create('AL-failed');
    const failedDoc = randomUUID();
    await repo.insertDocument({ id: failedDoc, shipmentId: failed.id, fileName: 'scan.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.updateDocumentStatus(failedDoc, 'FAILED', 'Unreadable PDF');
    await tick();

    // ocr: never validated (also not-validated "never"); cited by the latest run; validated without citing it (no alert).
    const ocrNew = await create('AL-ocr-new');
    const ocrNewDoc = await extracted(ocrNew.id, { ocr: true, fileName: 'new-scan.pdf' });
    const ocrCited = await create('AL-ocr-cited');
    const ocrCitedDoc = await extracted(ocrCited.id, { ocr: true, fileName: 'cited-scan.pdf' });
    await validated(ocrCited.id, ['LOW'], { documentId: ocrCitedDoc });
    const ocrChecked = await create('AL-ocr-checked');
    await extracted(ocrChecked.id, { ocr: true });
    await validated(ocrChecked.id, ['LOW']);

    // not-validated "changed": a document uploaded after the latest run; one still extracting holds the alert back.
    const changed = await create('AL-changed');
    await extracted(changed.id);
    await validated(changed.id);
    await extracted(changed.id);
    const extracting = await create('AL-extracting');
    await extracted(extracting.id);
    await repo.insertDocument({ id: randomUUID(), shipmentId: extracting.id, fileName: 'x.pdf', storageKey: 'none', sha256: '0', status: 'QUEUED' });

    // stale-destination: validated for CA, then moved to US.
    const stale = await create('AL-stale');
    await extracted(stale.id);
    await validated(stale.id);
    assert.equal((await call('PATCH', `/shipments/${stale.id}`, { destination: 'US' }, user)).status, 200);

    // Another user's shipment with every problem never shows up.
    const other = await signUp('Not mine');
    const { body: theirs } = await call('POST', '/shipments', { destination: 'CA' }, other);
    await extracted(theirs.id, { ocr: true });
    await validated(theirs.id, ['CRITICAL']);
    await repo.insertDocument({ id: randomUUID(), shipmentId: theirs.id, fileName: 'theirs.pdf', storageKey: 'none', sha256: '0', status: 'FAILED' });

    const { status, body } = await get();
    assert.equal(status, 200);
    assert.deepEqual(body.items.map((a) => [a.kind, a.reference, a.fileName, a.detail]), [
      ['stale-destination', 'AL-stale', undefined, { validated: 'CA', current: 'US' }],
      ['not-validated', 'AL-changed', undefined, { reason: 'changed' }],
      ['ocr', 'AL-ocr-cited', 'cited-scan.pdf', { citedBy: 1 }],
      ['not-validated', 'AL-ocr-new', undefined, { reason: 'never' }],
      ['ocr', 'AL-ocr-new', 'new-scan.pdf', { citedBy: 0 }],
      ['failed-document', 'AL-failed', 'scan.pdf', { error: 'Unreadable PDF' }],
      ['critical', 'AL-critical', undefined, { critical: 1, high: 2 }],
    ]);
    assert.deepEqual(body.counts, { critical: 1, 'failed-document': 1, ocr: 2, 'not-validated': 2, 'stale-destination': 1, 'mail-reply': 0, 'mail-overdue': 0, 'mail-failed': 0, 'mail-intake': 0 });
    assert.equal(body.total, 7);
    assert.equal(body.items.find((a) => a.kind === 'failed-document').documentId, failedDoc);
    assert.deepEqual(body.items.filter((a) => a.kind === 'ocr').map((a) => a.documentId), [ocrCitedDoc, ocrNewDoc]);
    assert.ok(body.items.every((a) => a.shipmentId !== theirs.id && !Number.isNaN(Date.parse(a.at))));

    // The other user sees only theirs; a visitor nothing.
    const their = (await call('GET', '/shipments/alerts', undefined, other)).body;
    assert.ok(their.total > 0 && their.items.every((a) => a.shipmentId === theirs.id));
    assert.equal((await call('GET', '/shipments/alerts', undefined, '')).status, 401);
  });

  it('caps the list but counts every alert', async () => {
    const user = await signUp('Many alerts');
    for (let i = 0; i < 22; i++) {
      const { body: s } = await call('POST', '/shipments', { destination: 'CA' }, user);
      await repo.insertDocument({ id: randomUUID(), shipmentId: s.id, fileName: `${i}.pdf`, storageKey: 'none', sha256: '0', status: 'FAILED' });
    }
    const { body } = await call('GET', '/shipments/alerts', undefined, user);
    assert.equal(body.items.length, 20);
    assert.deepEqual([body.counts['failed-document'], body.total], [22, 22]);
  });
});

describe('corrections', () => {
  /** A CA shipment of `user` with the sample documents extracted (no PDF text, so no source lookup). */
  const extractedShipment = async (user = cookie) => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' }, user);
    const ids = {};
    for (const [type, data] of Object.entries({ COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: sampleBillOfLading })) {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId: s.id, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
      ids[type] = id;
    }
    return { s, invoiceId: ids.COMMERCIAL_INVOICE, blId: ids.BILL_OF_LADING };
  };
  const dataPath = (s, documentId) => `/shipments/${s.id}/documents/${documentId}/data`;

  it('saves a valid change, records it and the next validation uses it, citing it as corrected', async () => {
    const { s, blId } = await extractedShipment();
    assert.deepEqual((await call('POST', `/shipments/${s.id}/validate?agent=false`)).body.findings, []);
    assert.equal((await call('GET', `/shipments/${s.id}`)).body.status, 'DONE');

    const saved = await call('PATCH', dataPath(s, blId), { changes: [{ path: '/totalPackages', value: 121 }] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.totalPackages, 121);
    assert.deepEqual(saved.body.corrected, [{ path: '/totalPackages', modelValue: sampleBillOfLading.totalPackages }]);
    assert.equal((await call('GET', `/shipments/${s.id}`)).body.status, 'RECEIVED'); // validate again

    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`);
    assert.deepEqual(run.body.findings.map((f) => f.ruleId), ['X2']);
    const ev = run.body.findings[0].evidence.find((e) => e.documentId === blId);
    assert.equal(ev.corrected, true);
    assert.ok(run.body.findings[0].evidence.filter((e) => e.documentId !== blId).every((e) => !e.corrected));

    const history = (await call('GET', `/shipments/${s.id}/documents/${blId}/corrections`)).body;
    assert.deepEqual(history.map((c) => [c.path, c.oldValue, c.newValue, c.action, c.userName]), [['/totalPackages', sampleBillOfLading.totalPackages, 121, 'edit', 'Test user']]);
  });

  it('rejects an invalid change with its issues and saves nothing', async () => {
    const { s, invoiceId } = await extractedShipment();
    const bad = await call('PATCH', dataPath(s, invoiceId), { changes: [{ path: '/invoiceNumber', value: 'OK-1' }, { path: '/lines/0/quantity/value', value: 'twelve' }] });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.issues.map((i) => i.path), ['/lines/0/quantity/value']);
    for (const changes of [[{ path: '/seller', value: 'x' }], [{ path: '/lines/99/sku', value: 'x' }], [{ path: '/notAField', value: 'x' }], [{ path: 'invoiceNumber', value: 'x' }], []]) {
      assert.equal((await call('PATCH', dataPath(s, invoiceId), { changes })).status, 400, JSON.stringify(changes));
    }
    const detail = (await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body;
    assert.equal(detail.data.invoiceNumber, sampleInvoice.invoiceNumber);
    assert.deepEqual(detail.corrected, []);
    assert.deepEqual((await call('GET', `/shipments/${s.id}/documents/${invoiceId}/corrections`)).body, []);
  });

  it('reverts to the model values, keeping the history; re-extracting clears it', async () => {
    const { s, invoiceId } = await extractedShipment();
    await call('PATCH', dataPath(s, invoiceId), { changes: [{ path: '/lines/0/description', value: 'Fixed' }, { path: '/poNumber', value: null }] });
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body.corrected.length, 2);

    const reverted = await call('POST', `${dataPath(s, invoiceId)}/revert`);
    assert.equal(reverted.status, 200);
    assert.deepEqual(reverted.body.data, sampleInvoice);
    assert.deepEqual(reverted.body.corrected, []);
    const history = (await call('GET', `/shipments/${s.id}/documents/${invoiceId}/corrections`)).body;
    assert.deepEqual(history.map((c) => c.action).sort(), ['edit', 'edit', 'revert', 'revert']);
    assert.equal((await call('POST', `${dataPath(s, invoiceId)}/revert`)).status, 400); // nothing left to revert

    await call('PATCH', dataPath(s, invoiceId), { changes: [{ path: '/invoiceNumber', value: 'INV-X' }] });
    await repo.saveExtraction(invoiceId, { pageCount: 1, detectedType: 'COMMERCIAL_INVOICE', typeConfidence: 1 }, { documentId: invoiceId, documentType: 'COMMERCIAL_INVOICE', model: 'test', promptVersion: 'test', raw: {}, data: sampleInvoice, issues: [], pdfLines: [] });
    const fresh = (await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body;
    assert.deepEqual([fresh.data.invoiceNumber, fresh.corrected], [sampleInvoice.invoiceNumber, []]);
    assert.deepEqual((await call('GET', `/shipments/${s.id}/documents/${invoiceId}/corrections`)).body, []);
  });

  it('updates the ISF taken from a corrected ISF PDF', async () => {
    const isf = { seller: sampleInvoice.seller, buyer: sampleInvoice.buyer, importerOfRecordNumber: '12-345678900', consigneeNumber: '12-345678900', manufacturer: sampleInvoice.seller, shipToParty: sampleInvoice.buyer, countryOfOrigin: 'CN', htsCode: '950300', containerStuffingLocation: sampleInvoice.seller.address, consolidator: sampleInvoice.seller };
    const { body: s } = await call('POST', '/shipments', { destination: 'US' });
    const id = randomUUID();
    await repo.insertDocument({ id, shipmentId: s.id, fileName: 'isf.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(id, { pageCount: 1, detectedType: 'ISF', typeConfidence: 1 }, { documentId: id, documentType: 'ISF', model: 'test', promptVersion: 'test', raw: {}, data: isf, issues: [], pdfLines: [] }, { shipmentId: s.id, data: isf, since: null });
    assert.equal((await call('PATCH', dataPath(s, id), { changes: [{ path: '/countryOfOrigin', value: 'VN' }] })).status, 200);
    assert.equal((await call('GET', `/shipments/${s.id}/isf`)).body.data.countryOfOrigin, 'VN');
    assert.equal((await call('PATCH', dataPath(s, id), { changes: [{ path: '/countryOfOrigin', value: 'Vietnam' }] })).status, 400);
  });

  it('is refused while the document extracts, and for another user\'s shipment', async () => {
    const { s, invoiceId } = await extractedShipment();
    const change = { changes: [{ path: '/invoiceNumber', value: 'INV-X' }] };
    await repo.updateDocumentStatus(invoiceId, 'EXTRACTING');
    assert.equal((await call('PATCH', dataPath(s, invoiceId), change)).status, 409);
    assert.equal((await call('POST', `${dataPath(s, invoiceId)}/revert`)).status, 409);
    await repo.updateDocumentStatus(invoiceId, 'EXTRACTED');

    const other = await signUp('Other');
    assert.equal((await call('PATCH', dataPath(s, invoiceId), change, other)).status, 404);
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${invoiceId}/corrections`, undefined, other)).status, 404);
    assert.equal((await call('POST', `${dataPath(s, invoiceId)}/revert`, undefined, other)).status, 404);
    assert.equal((await call('PATCH', dataPath(s, randomUUID()), change)).status, 404);
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${invoiceId}`)).body.data.invoiceNumber, sampleInvoice.invoiceNumber);
  });

  it('is blocked in the read-only demo', () => {
    // The guard straight from the build: the demo suite below needs the evaluation set.
    const { readOnlyGuard } = createRequire(import.meta.url)(join(root, 'apps/api/dist/demo/demo-mode.js'));
    const passes = (method, path) => {
      let next = false;
      readOnlyGuard({ method, path }, { status: () => ({ json: () => undefined }) }, () => (next = true));
      return next;
    };
    const id = randomUUID();
    assert.equal(passes('GET', `/shipments/${id}/documents/${id}/corrections`), true);
    assert.equal(passes('PATCH', `/shipments/${id}/documents/${id}/data`), false);
    assert.equal(passes('POST', `/shipments/${id}/documents/${id}/data/revert`), false);
  });
});

describe('finding reviews', () => {
  /** A CA shipment whose B/L says 121 packages (X2, HIGH), validated once clean and once with the finding. */
  const withFinding = async (user) => {
    const { body: s } = await call('POST', '/shipments', { destination: 'CA' }, user);
    const ids = {};
    for (const [type, data] of Object.entries({ COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: sampleBillOfLading })) {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId: s.id, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
      ids[type] = id;
    }
    await call('POST', `/shipments/${s.id}/validate?agent=false`, undefined, user);
    await call('PATCH', `/shipments/${s.id}/documents/${ids.BILL_OF_LADING}/data`, { changes: [{ path: '/totalPackages', value: 121 }] }, user);
    await call('POST', `/shipments/${s.id}/validate?agent=false`, undefined, user);
    return { s, blId: ids.BILL_OF_LADING };
  };

  it('records decisions, keeps them across runs, and counts only open findings', async () => {
    const user = await signUp('Reviews');
    const { s, blId } = await withFinding(user);
    const latest = (await call('GET', `/shipments/${s.id}/validation`, undefined, user)).body;
    assert.deepEqual(latest.findings.map((f) => [f.ruleId, f.isNew, f.review, f.history]), [['X2', true, undefined, []]]);
    assert.deepEqual(latest.resolved, []);
    const fp = latest.findings[0].fingerprint;
    assert.match(fp, /^[0-9a-f]{32}$/);
    const review = (body) => call('POST', `/shipments/${s.id}/findings/review`, body, user);
    const summary = async () => (await call('GET', '/shipments', undefined, user)).body;
    assert.equal((await summary()).items[0].findingCount, 1);

    assert.equal((await review({ fingerprints: [fp], status: 'accepted' })).status, 400); // needs a note
    assert.equal((await review({ fingerprints: ['0'.repeat(32)], status: 'open' })).status, 400);
    assert.equal((await review({ fingerprints: [fp], status: 'done' })).status, 400);

    const waiting = await review({ fingerprints: [fp], status: 'waiting_supplier', note: 'Asked the shipper' });
    assert.equal(waiting.status, 200);
    assert.deepEqual([waiting.body.findings[0].review.status, waiting.body.findings[0].review.note, waiting.body.findings[0].review.userName], ['waiting_supplier', 'Asked the shipper', 'Reviews']);
    assert.deepEqual([(await summary()).summary.findings, (await summary()).summary.waiting], [1, 1]);

    const accepted = (await review({ fingerprints: [fp], status: 'accepted', note: 'One pallet is a spare' })).body;
    assert.deepEqual(accepted.findings[0].history.map((h) => h.status), ['accepted', 'waiting_supplier']);
    const after = await summary();
    assert.deepEqual([after.items[0].findingCount, after.summary.findings, after.summary.waiting, after.summary.done], [0, 0, 0, 1]);
    const alerts = (await call('GET', '/shipments/alerts', undefined, user)).body;
    assert.equal((alerts.items ?? alerts).filter((a) => a.kind === 'critical').length, 0);

    // The same finding in a new run keeps its decision and is not new.
    const again = (await call('POST', `/shipments/${s.id}/validate?agent=false`, undefined, user), (await call('GET', `/shipments/${s.id}/validation`, undefined, user)).body);
    assert.deepEqual([again.findings[0].fingerprint, again.findings[0].review.status, again.findings[0].isNew], [fp, 'accepted', false]);

    // Reopened, it counts again; once the value is fixed it shows as resolved.
    await review({ fingerprints: [fp], status: 'open' });
    assert.equal((await summary()).items[0].findingCount, 1);
    await call('POST', `/shipments/${s.id}/documents/${blId}/data/revert`, undefined, user);
    await call('POST', `/shipments/${s.id}/validate?agent=false`, undefined, user);
    const fixed = (await call('GET', `/shipments/${s.id}/validation`, undefined, user)).body;
    assert.deepEqual([fixed.findings.length, fixed.resolved.map((f) => f.ruleId)], [0, ['X2']]);

    const other = await signUp('Not theirs');
    assert.equal((await call('POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'open' }, other)).status, 404);
  });
});

describe('mail', () => {
  // Builds raw messages the way a supplier's mail client would send them.
  const builder = createRequire(join(root, 'apps/api/package.json'))('nodemailer').createTransport({ streamTransport: true, buffer: true });
  const compose = (mail) => builder.sendMail(mail).then((info) => info.message);
  const inbound = (raw, secret = 'inbound-secret') => send(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': secret }, body: raw }, '');
  /** The captured .eml of an outgoing message whose subject has `text`, once the outbox sent it. */
  const sentMail = async (text) => {
    for (let i = 0; i < 50; i++) {
      const hit = readdirSync(mailDir).filter((f) => f.endsWith('.eml')).map((f) => readFileSync(join(mailDir, f), 'utf8')).find((m) => m.includes(text));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`No mail with ${text}`);
  };
  const header = (eml, name) => new RegExp(`^${name}: ?(.*(?:\n[ \t].*)*)`, 'mi').exec(eml)?.[1].replace(/\n[ \t]+/g, ' ').trim();
  const thread = (id, who) => call('GET', `/mail/threads/${id}`, undefined, who).then((r) => r.body);
  const until = async (check) => {
    for (let i = 0; i < 50; i++) {
      const value = await check();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out');
  };

  it('requests corrections, sends through the outbox, files the reply and its PDF, and answers', async () => {
    const user = await signUp('Mailer');
    const { body: s } = await call('POST', '/shipments', { destination: 'CA', reference: 'MAIL-1' }, user);
    for (const [type, data] of Object.entries({ COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: { ...sampleBillOfLading, totalPackages: 121 } })) {
      const id = randomUUID();
      await repo.insertDocument({ id, shipmentId: s.id, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
      await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
    }
    const run = (await call('POST', `/shipments/${s.id}/validate?agent=false`, undefined, user), (await call('GET', `/shipments/${s.id}/validation`, undefined, user)).body);
    const fp = run.findings[0].fingerprint;

    const bad = await call('POST', '/mail/threads', { kind: 'correction_request', shipmentId: s.id, to: ['not an email'], subject: 'x', body: 'y', fingerprints: [fp] }, user);
    assert.equal(bad.status, 400);
    const created = await call('POST', '/mail/threads', { kind: 'correction_request', shipmentId: s.id, to: ['Supplier@Example.com'], subject: 'Corrections needed: MAIL-1', body: 'Please fix the package count.', language: 'en', fingerprints: [fp] }, user);
    assert.equal(created.status, 201);
    const t = created.body;
    assert.deepEqual([t.kind, t.status, t.items.length, t.items[0].to, t.partyName], ['correction_request', 'awaiting', 1, ['supplier@example.com'], sampleInvoice.seller.name]);
    assert.equal((await call('GET', `/shipments/${s.id}/validation`, undefined, user)).body.findings[0].review.status, 'waiting_supplier');

    // The outbox sends it (captured: no SMTP in tests), threaded and tagged.
    const sent = await until(async () => (await thread(t.id, user)).items[0].status === 'sent' && (await thread(t.id, user)));
    assert.equal(sent.items[0].transport, 'log');
    const eml = await sentMail('Corrections needed: MAIL-1');
    const tag = /\[DC-([a-z0-9]+)\]/.exec(header(eml, 'Subject'))[1];
    assert.equal(header(eml, 'Reply-To'), `docs+${tag}@doccheck.example`);
    // An HTML part with the mark inline, besides the text part.
    assert.match(eml, /Content-Type: text\/html/);
    assert.match(eml, /cid:logo@doccheck/);
    assert.match(eml, /Content-ID: <logo@doccheck>/);
    const ourId = header(eml, 'Message-ID').replace(/[<>]/g, '');

    // The supplier answers with a corrected PDF.
    assert.equal((await inbound(Buffer.from('x'), 'wrong')).status, 403);
    const reply = await compose({ from: 'Supplier <supplier@example.com>', to: `docs+${tag}@doccheck.example`, subject: 'Re: Corrections needed', inReplyTo: `<${ourId}>`, messageId: '<reply-1@example.com>', text: 'Corrected B/L attached.', attachments: [{ filename: 'bl-corrected.pdf', content: Buffer.from('%PDF-1.4\n%fake\n'), contentType: 'application/pdf' }, { filename: 'run.exe', content: Buffer.from('MZ'), contentType: 'application/octet-stream' }] });
    const received = await inbound(reply);
    assert.equal(received.status, 202);
    assert.deepEqual(await received.json().then((b) => [b.status, b.threadId]), ['stored', t.id]);
    assert.equal(await inbound(reply).then((r) => r.json()).then((b) => b.status), 'duplicate');

    const after = await thread(t.id, user);
    assert.deepEqual([after.status, after.unread, after.items[1].direction, after.items[1].text.trim(), after.items[1].attachments.map((a) => a.filename)], ['replied', 1, 'in', 'Corrected B/L attached.', ['bl-corrected.pdf']]);
    assert.deepEqual((await call('GET', '/mail/summary', undefined, user)).body, { unread: 1, awaiting: 0, overdue: 0, failed: 0 });
    const alerts = (await call('GET', '/shipments/alerts', undefined, user)).body;
    assert.deepEqual((alerts.items ?? alerts).filter((a) => a.kind === 'mail-reply').map((a) => a.detail.threadId), [t.id]);

    // Its PDF goes into the shipment as a document.
    const att = after.items[1].attachments[0];
    const file = await send(`${base}/mail/attachments/${att.id}/file`, {}, user);
    assert.deepEqual([file.status, file.headers.get('content-type'), file.headers.get('content-disposition')], [200, 'application/pdf', 'inline; filename="bl-corrected.pdf"']);
    const imported = await call('POST', `/mail/attachments/${att.id}/import`, undefined, user);
    assert.equal(imported.status, 200);
    assert.ok((await call('GET', `/shipments/${s.id}`, undefined, user)).body.documents.some((d) => d.id === imported.body.documentId));
    assert.equal((await call('POST', `/mail/attachments/${att.id}/import`, undefined, user)).status, 400);

    // A reply without threading headers still finds its thread by the subject tag; a stranger's mail stays unassigned.
    const bare = await compose({ from: 'other@example.com', to: 'docs@doccheck.example', subject: `Fwd: question [DC-${tag}]`, messageId: '<reply-2@example.com>', text: 'Also this.' });
    assert.equal(await inbound(bare).then((r) => r.json()).then((b) => b.threadId), t.id);
    const stray = await compose({ from: 'spam@example.com', to: 'docs@doccheck.example', subject: 'Hello', messageId: '<stray@example.com>', text: 'Buy now' });
    assert.equal(await inbound(stray).then((r) => r.json()).then((b) => b.threadId), null);

    // Answering from the app threads on the latest message and goes out.
    await call('POST', `/mail/threads/${t.id}/read`, undefined, user);
    const answered = await call('POST', `/mail/threads/${t.id}/reply`, { body: 'Thank you, received.' }, user);
    assert.deepEqual([answered.status, answered.body.status, answered.body.unread, answered.body.items.at(-1).to], [200, 'awaiting', 0, ['other@example.com']]);
    const out = await sentMail('Thank you, received.');
    assert.equal(header(out, 'In-Reply-To'), '<reply-2@example.com>');
    assert.match(header(out, 'Subject'), new RegExp(`^Re: Corrections needed: MAIL-1 \\[DC-${tag}\\]$`));

    assert.equal((await call('POST', `/mail/threads/${t.id}/status`, { status: 'closed' }, user)).body.status, 'closed');
    const listed = (await call('GET', '/mail/threads?filter=closed', undefined, user)).body;
    assert.deepEqual(listed.items.map((x) => [x.id, x.shipmentReference, x.messages]), [[t.id, 'MAIL-1', 4]]);
    assert.equal((await call('POST', `/mail/messages/${after.items[0].id}/retry`, undefined, user)).status, 400);

    // Hostile mail: a NUL in the subject is stored, a fake bounce (not a delivery report) marks nothing,
    // and a forged From with a second address is answered at the first address only.
    const nul = Buffer.from(`From: "Evil, Inc" <evil@example.com>, other@evil.example\r\nTo: docs+${tag}@doccheck.example\r\nSubject: =?utf-8?Q?a=00b?=\r\nMessage-ID: <nul@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nhi=00there\r\n`);
    assert.equal(await inbound(nul).then((r) => r.json()).then((b) => b.status), 'stored');
    const fakeBounce = await compose({ from: 'MAILER-DAEMON@example.com', to: 'docs@doccheck.example', subject: 'Undelivered', messageId: '<fake-bounce@example.com>', text: `Message-ID: <${ourId}>` });
    await inbound(fakeBounce);
    const hostile = await thread(t.id, user);
    assert.equal(hostile.items[0].status, 'sent');
    assert.equal(hostile.items.find((m) => m.subject === 'ab')?.from, 'Evil, Inc <evil@example.com>');
    const toFirst = await call('POST', `/mail/threads/${t.id}/reply`, { body: 'Who are you?' }, user);
    assert.deepEqual(toFirst.body.items.at(-1).to, ['evil@example.com']);

    const other = await signUp('Not theirs');
    assert.equal((await call('GET', `/mail/threads/${t.id}`, undefined, other)).status, 404);
    assert.equal((await send(`${base}/mail/attachments/${att.id}/file`, {}, other)).status, 404);
    assert.equal((await call('GET', '/mail/unassigned', undefined, other)).status, 403);
    const status = (await call('GET', '/mail/status', undefined, other)).body;
    assert.deepEqual(Object.keys(status).sort(), ['from', 'replyTo', 'sending']);
    assert.equal(status.sending, 'log');
    // The preview is the HTML part, with the logo as a data URL and the text escaped.
    const preview = (await call('POST', '/mail/preview', { subject: 'S', body: '1. <b>x</b>\n   - Invoice · total: 5', language: 'es' }, other)).body.html;
    assert.match(preview, /data:image\/png;base64,/);
    assert.match(preview, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(preview, /Responde a este correo/);
  });

  it('refuses webhook calls without the secret before reading them, and limits sending even in parallel', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 120);
    assert.equal((await send(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822' }, body: big }, '')).status, 403);
    assert.equal((await send(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-inbound-secret': 'inbound-secret' }, body: '{not json' }, '')).status, 400);

    const user = await signUp('Bulk');
    const tries = await Promise.all(
      Array.from({ length: 12 }, (_, i) => call('POST', '/mail/threads', { to: [`x${i}@example.com`], subject: `Hello ${i}`, body: 'Hi' }, user)),
    );
    assert.deepEqual([tries.filter((r) => r.status === 201).length, tries.filter((r) => r.status === 429).length], [8, 4]);
  });
});

describe('mail server settings and documents by email', () => {
  const builder = createRequire(join(root, 'apps/api/package.json'))('nodemailer').createTransport({ streamTransport: true, buffer: true });
  const compose = (mail) => builder.sendMail(mail).then((info) => info.message);
  const inbound = (raw) => send(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'inbound-secret' }, body: raw }, '');
  const adminLogin = async () => {
    let res = await call('POST', '/auth/login', { email: 'admin-e2e@example.com', password: 'admin password' }, '');
    if (res.status === 401) res = await call('POST', '/auth/register', { email: 'admin-e2e@example.com', password: 'admin password', name: 'Admin' }, '');
    return res.cookie;
  };
  const base64 = { from: 'DocCheck <docs@doccheck.example>', replyTo: null, plusAddressing: true, intake: { enabled: true, notifySender: true } };

  it('is set by admins, keeps passwords sealed and never sends them back, tests and resets', async () => {
    const admin = await adminLogin();
    assert.equal((await call('GET', '/admin/mail')).status, 403);
    assert.equal((await call('GET', '/admin/mail', undefined, admin)).body.source, 'env');
    assert.equal((await call('POST', '/admin/mail/test', { kind: 'smtp' }, admin)).body.ok, false); // nothing saved
    const config = { ...base64, smtp: { host: '127.0.0.1', port: 9, secure: false, user: 'mailer', password: 'smtp-secret-123' }, imap: null };
    const saved = await call('PUT', '/admin/mail', config, admin);
    assert.equal(saved.status, 200);
    assert.deepEqual([saved.body.source, saved.body.config.smtp.hasPassword, saved.body.config.intake.enabled], ['admin', true, true]);
    assert.ok(!JSON.stringify(saved.body).includes('smtp-secret-123'));
    const { rows } = await pool.query(`select value::text as v from settings where key = 'mailServer'`);
    assert.ok(!rows[0].v.includes('smtp-secret-123'), 'stored sealed');
    // An empty password keeps the saved one; a test reports the server's answer, not a credential.
    const kept = await call('PUT', '/admin/mail', { ...config, smtp: { ...config.smtp, password: '' } }, admin);
    assert.equal(kept.body.config.smtp.hasPassword, true);
    const test = (await call('POST', '/admin/mail/test', { kind: 'smtp' }, admin)).body;
    assert.equal(test.ok, false);
    assert.ok(!test.detail.includes('smtp-secret-123'));
    assert.equal((await call('POST', '/admin/mail/test', { kind: 'imap' }, admin)).body.ok, false);
    assert.equal((await call('PUT', '/admin/mail', { ...base64, smtp: null, imap: { host: 'imap.example.com', port: 993, secure: true, user: 'u' } }, admin)).status, 400); // no password yet
    assert.equal((await call('DELETE', '/admin/mail', undefined, admin)).body.source, 'env');
  });

  it('checks that the mail server takes +codes, and turns them off when mail to one bounces', async () => {
    // A tiny SMTP server: refuses "+" recipients while `refuse` is set, records the others.
    let refuse = true;
    const received = [];
    const smtp = createServer((socket) => {
      let data = false;
      socket.write('220 test ESMTP\r\n');
      createInterface({ input: socket }).on('line', (line) => {
        if (data) return void (line === '.' && ((data = false), socket.write('250 queued\r\n')));
        const rcpt = /^RCPT TO:<([^>]+)>/i.exec(line)?.[1];
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250 test\r\n');
        else if (rcpt && refuse && rcpt.includes('+')) socket.write('550 5.1.1 <' + rcpt + '>: No such user\r\n');
        else if (rcpt) received.push(rcpt), socket.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) (data = true), socket.write('354 go on\r\n');
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      });
    });
    await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
    const admin = await adminLogin();
    const config = { ...base64, smtp: { host: '127.0.0.1', port: smtp.address().port, secure: false, user: '' }, imap: null };
    try {
      // The server refuses the test address while sending: +codes are turned off on the spot.
      let saved = (await call('PUT', '/admin/mail', config, admin)).body;
      assert.deepEqual([saved.plusCheck.status, saved.plusCheck.turnedOff, saved.config.plusAddressing], ['rejected', true, false]);
      assert.match(saved.plusCheck.address, /^docs\+probe-[a-z0-9]{8}@doccheck\.example$/);
      assert.match(saved.plusCheck.detail, /No such user/);

      // Accepted while sending, then a delivery report for it comes back.
      refuse = false;
      saved = (await call('PUT', '/admin/mail', config, admin)).body;
      assert.equal(saved.plusCheck.status, 'checking');
      const probe = received.at(-1);
      assert.equal(probe, saved.plusCheck.address);
      const dsn = Buffer.from(
        [
          'From: Mail Delivery System <MAILER-DAEMON@mx.doccheck.example>',
          'To: docs@doccheck.example',
          'Subject: Undelivered Mail Returned to Sender',
          'Message-ID: <dsn-plus@mx.doccheck.example>',
          'MIME-Version: 1.0',
          'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
          '',
          '--b',
          'Content-Type: text/plain',
          '',
          'Your message could not be delivered.',
          '--b',
          'Content-Type: message/delivery-status',
          '',
          'Reporting-MTA: dns; mx.doccheck.example',
          '',
          `Final-Recipient: rfc822; ${probe}`,
          'Action: failed',
          'Status: 5.1.1',
          'Diagnostic-Code: smtp; 550 5.1.1 Recipient address rejected: User unknown',
          '--b--',
          '',
        ].join('\r\n'),
      );
      await inbound(dsn);
      saved = (await call('GET', '/admin/mail', undefined, admin)).body;
      assert.deepEqual([saved.plusCheck.status, saved.plusCheck.detail, saved.config.plusAddressing], ['rejected', '550 5.1.1 Recipient address rejected: User unknown', false]);

      // The test email arrives: +codes work, and the message is not kept.
      saved = (await call('PUT', '/admin/mail', config, admin)).body;
      const arrived = await compose({ from: 'docs@doccheck.example', to: received.at(-1), subject: 'DocCheck: reply address check', messageId: '<probe-arrived@doccheck.example>', text: 'x' });
      assert.equal(await inbound(arrived).then((r) => r.json()).then((b) => b.status), 'probe');
      assert.equal((await call('GET', '/admin/mail', undefined, admin)).body.plusCheck.status, 'ok');
      // A delivery report for an address that is not ours, or a stranger's plain bounce, changes nothing.
      await inbound(Buffer.from(dsn.toString().replace(`Final-Recipient: rfc822; ${probe}`, 'Final-Recipient: rfc822; docs+zzzzzzzz@doccheck.example').replace('dsn-plus@', 'dsn-plus-2@')));
      assert.equal((await call('GET', '/admin/mail', undefined, admin)).body.plusCheck.status, 'ok');
    } finally {
      await call('DELETE', '/admin/mail', undefined, admin);
      smtp.close();
    }
  });

  it('turns an email with PDFs to a user\'s intake address into a shipment, checked without opening the app', { skip: !hasSample && 'evaluation set not generated' }, async () => {
    const admin = await adminLogin();
    assert.equal((await call('PUT', '/admin/mail', { ...base64, smtp: null, imap: null }, admin)).status, 200);
    try {
      const user = await signUp('Intake');
      const me = (await call('GET', '/auth/me', undefined, user)).body;
      const { address, enabled } = (await call('GET', '/mail/intake', undefined, user)).body;
      assert.equal(enabled, true);
      assert.match(address, /^docs\+in-[a-z0-9]+@doccheck\.example$/);
      const pdfs = ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf'].map((f) => ({ filename: f, content: readFileSync(join(sample, f)), contentType: 'application/pdf' }));
      const mail = await compose({ from: me.email, to: address, subject: 'Fwd: PO-7781 documents', messageId: '<intake-1@example.com>', text: 'Documents attached.', attachments: pdfs });
      assert.equal(await inbound(mail).then((r) => r.json()).then((b) => b.status), 'stored');

      const threads = (await call('GET', '/mail/threads?filter=all', undefined, user)).body.items;
      assert.deepEqual(threads.map((t) => [t.kind, t.subject]), [['intake', 'Fwd: PO-7781 documents']]);
      let thread;
      for (let i = 0; i < 300; i++) {
        thread = (await call('GET', `/mail/threads/${threads[0].id}`, undefined, user)).body;
        if (thread.intakes?.[0] && !['extracting', 'validating'].includes(thread.intakes[0].status)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const intake = thread.intakes[0];
      assert.deepEqual([intake.status, intake.documents, intake.createdShipment, typeof intake.findings], ['validated', 3, true, 'number']);
      const shipment = (await call('GET', `/shipments/${intake.shipmentId}`, undefined, user)).body;
      assert.deepEqual([shipment.reference, shipment.destination, shipment.status], ['PO-7781 documents', 'CA', 'DONE']);
      assert.ok(thread.items[0].attachments.every((a) => a.documentId));
      // The sender is the user: a summary goes back to them in the same conversation.
      const summary = thread.items.find((m) => m.direction === 'out');
      assert.deepEqual(summary?.to, [me.email]);
      assert.match(summary.text, /PO-7781 documents was read and checked/);
      const alerts = (await call('GET', '/shipments/alerts', undefined, user)).body;
      assert.deepEqual(alerts.items.filter((a) => a.kind === 'mail-intake').map((a) => a.detail.status), ['validated']);

      // A second email naming the reference adds to that shipment; the summary is in the app's language.
      assert.equal((await call('PUT', '/auth/me/language', { language: 'es' }, user)).status, 204);
      const more = await compose({ from: me.email, to: address, subject: 'PO-7781 documents: corrected invoice', messageId: '<intake-2@example.com>', text: 'Corrected.', attachments: [pdfs[0]] });
      await inbound(more);
      const second = (await call('GET', '/mail/threads?filter=all', undefined, user)).body.items.find((t) => t.subject.includes('corrected'));
      const detail = (await call('GET', `/mail/threads/${second.id}`, undefined, user)).body;
      assert.deepEqual([detail.intakes[0].shipmentId, detail.intakes[0].createdShipment], [intake.shipmentId, false]);
      let reply;
      for (let i = 0; i < 300 && !reply; i++) {
        reply = (await call('GET', `/mail/threads/${second.id}`, undefined, user)).body.items.find((m) => m.direction === 'out');
        if (!reply) await new Promise((r) => setTimeout(r, 200));
      }
      assert.match(reply.text, /^El envío PO-7781 documents se leyó y se validó/);

      // From the user's address without the intake address: only when the receiving server verified it.
      const spoofed = await compose({ from: me.email, to: 'docs@doccheck.example', subject: 'Unverified', messageId: '<intake-3@example.com>', text: 'x', attachments: [pdfs[0]] });
      assert.equal(await inbound(spoofed).then((r) => r.json()).then((b) => b.threadId), null);
      const verified = await compose({ from: me.email, to: 'docs@doccheck.example', subject: 'Verified', messageId: '<intake-4@example.com>', text: 'x', attachments: [pdfs[0]], headers: { 'Authentication-Results': 'mx.example.com; dkim=pass header.d=example.com; dmarc=pass' } });
      assert.ok(await inbound(verified).then((r) => r.json()).then((b) => b.threadId));
      // Someone else's mail to the user's address is accepted (the address is the key) but never answered.
      assert.equal((await call('GET', '/mail/intake', undefined, await signUp('Other'))).body.address === address, false);
    } finally {
      await call('DELETE', '/admin/mail', undefined, admin);
    }
  });
});

describe('ISF PDF upload', { skip: !isfSample && 'no ISF PDF with a cached model response' }, () => {
  const upload = async (shipmentId) => {
    const form = new FormData();
    form.append('files', new Blob([readFileSync(join(isfSample, 'isf.pdf'))], { type: 'application/pdf' }), 'isf.pdf');
    const res = await send(`${base}/shipments/${shipmentId}/documents?wait=true`, { method: 'POST', body: form });
    assert.equal(res.status, 202);
    return (await res.json()).documents[0].document;
  };

  it('extracts the filing, stores it as the shipment ISF and X11 cites the PDF', async () => {
    const truth = JSON.parse(readFileSync(join(isfSample, 'truth.json'), 'utf8'));
    const labels = JSON.parse(readFileSync(join(isfSample, 'labels.json'), 'utf8'));
    const { body: s } = await call('POST', '/shipments', { destination: 'US' });
    const doc = await upload(s.id);
    assert.equal(doc.status, 'EXTRACTED');
    assert.equal(doc.detectedType, 'ISF');

    const isf = await call('GET', `/shipments/${s.id}/isf`);
    assert.equal(isf.status, 200);
    assert.equal(isf.body.source, 'pdf');
    assert.equal(isf.body.documentId, doc.id);
    assert.equal(isf.body.fileName, 'isf.pdf');
    for (const k of ['countryOfOrigin', 'htsCode', 'importerOfRecordNumber']) assert.equal(isf.body.data[k], truth.documents.isf[k]);

    // The paper documents come as JSON; the ISF PDF does not take the place of any of them.
    const { invoice, packingList, billOfLading } = truth.documents;
    const run = await call('POST', `/shipments/${s.id}/validate?agent=false`, { invoice, packingList, billOfLading });
    assert.equal(run.status, 200);
    assert.deepEqual(run.body.skipped, []);
    assert.ok(run.body.ran.includes('X11'));
    assert.equal((await call('GET', `/shipments/${s.id}/validation`)).body.inputs.isf, doc.id);
    const x11 = run.body.findings.filter((f) => f.ruleId === 'X11');
    assert.equal(x11.length > 0, labels.errors.some((e) => e.expectedRuleIds.includes('X11')));
    for (const f of x11) assert.ok(f.evidence.some((e) => e.documentId === doc.id && e.source?.page === 1));

    // A JSON ISF still replaces it.
    assert.equal((await call('PUT', `/shipments/${s.id}/isf`, truth.documents.isf)).status, 200);
    const json = await call('GET', `/shipments/${s.id}/isf`);
    assert.equal(json.body.source, 'upload');
    assert.equal(json.body.documentId, undefined);
  });

  it('is not used on a Canadian shipment and never counts as a missing paper document', async () => {
    const { body: us } = await call('POST', '/shipments', { destination: 'US' });
    const isfDoc = await upload(us.id);
    const partial = await call('POST', `/shipments/${us.id}/validate?agent=false`);
    assert.ok(partial.body.skipped.every((x) => !x.missing.includes('ISF')));
    assert.ok(partial.body.skipped.some((x) => x.ruleId === 'X11' && x.missing.includes('COMMERCIAL_INVOICE')));

    // Re-extracted as another type, it stops being the shipment's ISF.
    const again = await send(`${base}/shipments/${us.id}/documents/${isfDoc.id}/reextract?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'COMMERCIAL_INVOICE' }) });
    assert.equal(again.status, 202);
    assert.equal((await call('GET', `/shipments/${us.id}/isf`)).status, 404);

    const { body: ca } = await call('POST', '/shipments', { destination: 'CA' });
    const doc = await upload(ca.id);
    assert.equal((await call('GET', `/shipments/${ca.id}/isf`)).status, 404);
    const detail = await call('GET', `/shipments/${ca.id}/documents/${doc.id}`);
    assert.ok(detail.body.issues.some((i) => i.includes('only applies to US-bound shipments')));
  });
});

// Read-only demo: a second API process with DEMO_READONLY=true over a samples folder holding CA-001
// (cached) and a copy of it renamed CA-999 with its PDFs swapped (the invoice file holds the bill of
// lading...), so the demo never finds CA-999's extraction in the cache.
describe('read-only demo', { skip: !hasSample && 'evaluation set not generated' }, () => {
  const demoPort = port + 1;
  const demoBase = `http://localhost:${demoPort}`;
  let demo;
  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'doccheck-e2e-demo-'));
    const files = ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf', 'truth.json', 'labels.json'];
    for (const id of ['CA-001', 'CA-999']) {
      mkdirSync(join(dir, id));
      const swap = { 'invoice.pdf': 'bill-of-lading.pdf', 'packing-list.pdf': 'invoice.pdf', 'bill-of-lading.pdf': 'packing-list.pdf' };
      for (const f of files) writeFileSync(join(dir, id, f), readFileSync(join(sample, id === 'CA-999' ? (swap[f] ?? f) : f)));
    }
    const manifest = JSON.parse(readFileSync(join(root, 'data/eval/v1/manifest.json'), 'utf8'));
    const ca1 = manifest.shipments.find((s) => s.id === 'CA-001');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, shipments: [ca1, { ...ca1, id: 'CA-999' }] }));
    demo = spawn('node', [join(root, 'apps/api/dist/main.js')], {
      cwd: root,
      env: { ...process.env, PORT: String(demoPort), DATABASE_URL: testUrl, REDIS_URL: '', S3_ENDPOINT: '', STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-e2e-')), DEMO_READONLY: 'true', DEMO_PACING: 'false', EVAL_DIR: dir, LLM_CACHE_DIR: llmCacheDir, OLLAMA_BASE_URL: 'http://127.0.0.1:9' },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${demoBase}/health`)).ok) {
          // Accounts work in the demo: sign up there like a visitor.
          const res = await fetch(`${demoBase}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@example.com`, password: 'correct horse battery', name: 'Visitor' }) });
          assert.equal(res.status, 201);
          demoCookie = sessionCookie(res);
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Demo API did not start');
  });
  after(() => demo?.kill());

  let demoCookie = '';
  const demoCall = async (method, path, body) => {
    const res = await fetch(demoBase + path, { method, headers: { cookie: demoCookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  it('refuses every write except loading and validating a sample', async () => {
    assert.equal((await demoCall('GET', '/health')).body.demo, true);
    const id = randomUUID();
    for (const [method, path] of [['POST', '/shipments'], ['DELETE', `/shipments/${id}`], ['PATCH', `/shipments/${id}`], ['PUT', `/shipments/${id}/isf`], ['DELETE', `/shipments/${id}/isf`], ['POST', `/shipments/${id}/documents`], ['POST', `/shipments/${id}/documents/${id}/reextract`], ['PATCH', `/shipments/${id}/documents/${id}/data`], ['POST', `/shipments/${id}/documents/${id}/data/revert`]]) {
      assert.equal((await demoCall(method, path, {})).status, 403, `${method} ${path}`);
    }
  });

  it('lists only cached samples and replays them without the model', async () => {
    assert.deepEqual((await demoCall('GET', '/demo/samples')).body.map((s) => s.id), ['CA-001']);
    assert.equal((await demoCall('POST', '/demo/samples/CA-999')).status, 404);
    const [a, b] = await Promise.all([demoCall('POST', '/demo/samples/CA-001'), demoCall('POST', '/demo/samples/CA-001')]);
    assert.equal(a.body.id, b.body.id);
    for (let i = 0; i < 40; i++) {
      const s = (await demoCall('GET', `/shipments/${a.body.id}`)).body;
      if (s.documents.length === 3 && s.documents.every((d) => d.status === 'EXTRACTED')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const run = await demoCall('POST', `/shipments/${a.body.id}/validate?agent=false`);
    assert.equal(run.status, 200);
    const expected = JSON.parse(readFileSync(join(sample, 'labels.json'), 'utf8')).errors.flatMap((e) => e.expectedRuleIds).sort();
    assert.deepEqual([...new Set(run.body.findings.map((f) => f.ruleId))].sort(), expected);
  });
});
