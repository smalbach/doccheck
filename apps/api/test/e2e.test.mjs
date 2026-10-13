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
    assert.deepEqual(list.settings.map((x) => x.key), ['llmModel', 'agentEnabled', 'registrationOpen', 'ocrLanguages', 'ocrScale', 'ocrPsm']);
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
    assert.deepEqual(first.summary, { all: 4, open: 3, attention: 0, done: 1, findings: 0 });
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
    assert.deepEqual((await get()).body, { items: [], counts: { critical: 0, 'failed-document': 0, ocr: 0, 'not-validated': 0, 'stale-destination': 0 }, total: 0 });

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
    assert.deepEqual(body.counts, { critical: 1, 'failed-document': 1, ocr: 2, 'not-validated': 2, 'stale-destination': 1 });
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
      env: { ...process.env, PORT: String(demoPort), DATABASE_URL: testUrl, REDIS_URL: '', S3_ENDPOINT: '', STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-e2e-')), DEMO_READONLY: 'true', EVAL_DIR: dir, LLM_CACHE_DIR: llmCacheDir, OLLAMA_BASE_URL: 'http://127.0.0.1:9' },
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
    for (const [method, path] of [['POST', '/shipments'], ['DELETE', `/shipments/${id}`], ['PATCH', `/shipments/${id}`], ['PUT', `/shipments/${id}/isf`], ['DELETE', `/shipments/${id}/isf`], ['POST', `/shipments/${id}/documents`], ['POST', `/shipments/${id}/documents/${id}/reextract`]]) {
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
