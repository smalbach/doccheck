// End-to-end tests of organizations (docs/ORGANIZATIONS.md) against the built API and a real Postgres:
// isolation between organizations, roles, invitations, sharing with clients, assignments, comments with
// mentions, notifications, two-step approval, due dates, the audit log, retention, TOTP, sessions and
// OpenID Connect sign-in (against a small provider started here). No model is needed.
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Runs beside e2e.test.mjs: its own database (the test database name with "_orgs" before "_test") and
// port (E2E_PORT + 1).
import { writeCsv, writeXlsx } from '@doccheck/extraction';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { spawn } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
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
require('reflect-metadata');
const { totp, totpCounter, hotp, base32Decode } = require('../dist/auth/totp.js');
const { migrate, MIGRATIONS_DIR } = require('../dist/db/migrate.js');

const baseUrl = (() => {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const u = new URL(process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  u.pathname = '/doccheck_test';
  return u.toString();
})();
const withDb = (name) => {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
};
const baseName = new URL(baseUrl).pathname.slice(1);
// A test database name ends in _test or has _test_ in it (doccheck_test_api); the schema is dropped.
if (!/_test($|_)/.test(baseName)) throw new Error(`Refusing to reset "${baseName}": the test database name must end in _test`);
const testUrl = withDb(baseName.replace(/_test($|_)/, '_orgs_test$1'));
const migrationUrl = withDb(baseName.replace(/_test($|_)/, '_orgs_migration_test$1'));

const port = Number(process.env.E2E_PORT ?? 3990) + 1;
const base = `http://localhost:${port}`;
const mailDir = mkdtempSync(join(tmpdir(), 'doccheck-orgs-mail-'));
let api;
let pool;
let repo;
const { ShipmentsRepository } = require('../dist/shipments/shipments.repository.js');

async function resetDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  const c = new pg.Client({ connectionString: withDb('postgres') });
  await c.connect();
  if ((await c.query('select 1 from pg_database where datname = $1', [name])).rowCount === 0) await c.query(`create database ${name}`);
  await c.end();
  const t = new pg.Client({ connectionString: url });
  await t.connect();
  await t.query('drop schema public cascade; create schema public');
  await t.end();
}

const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';
const call = async (method, path, body, as = '') => {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(as ? { cookie: as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, cookie: sessionCookie(res), headers: res.headers };
};

/** A new account: { cookie, id, email, name }. */
const signUp = async (name) => {
  const email = `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID().slice(0, 8)}@example.com`;
  const res = await call('POST', '/auth/register', { email, password: 'correct horse battery', name });
  assert.equal(res.status, 201);
  return { cookie: res.cookie, id: res.body.id, email, name };
};

/** Mail the API captured (no SMTP in tests), newest last. */
const mails = () =>
  readdirSync(mailDir)
    .sort()
    .map((f) => JSON.parse(readFileSync(join(mailDir, f), 'utf8')));
const waitForMail = async (match, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = mails().filter(match).at(-1);
    if (found) return found;
    if (Date.now() > deadline) throw new Error('No such mail');
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Invites `email` with `role` from the active organization of `by`, and accepts as `who`. */
const join_ = async (by, who, role) => {
  const res = await call('POST', '/orgs/current/invites', { email: who.email, role }, by.cookie);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const mail = await waitForMail((m) => m.to === who.email && /invited you/.test(m.subject));
  const token = /token=([\w-]+)/.exec(mail.text)[1];
  const accepted = await call('POST', '/orgs/invites/accept', { token }, who.cookie);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return token;
};

/** A CA shipment validated from JSON documents whose B/L says 121 packages: one X2 finding. */
const shipmentWithFinding = async (as) => {
  const { body: s } = await call('POST', '/shipments', { destination: 'CA', reference: `R-${randomUUID().slice(0, 6)}` }, as);
  const docs = { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: { ...sampleBillOfLading, totalPackages: 121 } };
  assert.equal((await call('POST', `/shipments/${s.id}/validate?agent=false`, docs, as)).status, 200);
  const latest = (await call('GET', `/shipments/${s.id}/validation`, undefined, as)).body;
  return { s, fp: latest.findings[0].fingerprint };
};

// A small OpenID provider: discovery, keys, an authorize endpoint that signs in whoever `idp.email`
// says, and a token endpoint checking the PKCE verifier.
const idp = { email: '', name: 'SSO User', verified: true, codes: new Map() };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
let idpServer;
let issuer;
const signJwt = (claims) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${enc(claims)}`;
  return `${data}.${createSign('sha256').update(data).sign(privateKey).toString('base64url')}`;
};
const startIdp = () =>
  new Promise((done) => {
    idpServer = createServer(async (req, res) => {
      const url = new URL(req.url, issuer);
      const json = (o, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
      }
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const code = randomUUID();
        idp.codes.set(code, { nonce: url.searchParams.get('nonce'), clientId: url.searchParams.get('client_id'), challenge: url.searchParams.get('code_challenge') });
        const back = new URL(url.searchParams.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state'));
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const grant = idp.codes.get(form.get('code'));
        idp.codes.delete(form.get('code'));
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!grant || grant.challenge !== challenge || form.get('client_secret') !== 'idp-secret') return json({ error: 'invalid_grant' }, 400);
        const now = Math.floor(Date.now() / 1000);
        return json({
          id_token: signJwt({ iss: issuer, sub: idp.email, aud: grant.clientId, exp: now + 300, iat: now, nonce: grant.nonce, email: idp.email, email_verified: idp.verified, name: idp.name }),
        });
      }
      res.writeHead(404);
      res.end();
    });
    idpServer.listen(0, () => {
      issuer = `http://localhost:${idpServer.address().port}`;
      done();
    });
  });

before(async () => {
  await resetDatabase(testUrl);
  await startIdp();
  api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: testUrl,
      REDIS_URL: '',
      S3_ENDPOINT: '',
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-orgs-')),
      AGENT_ENABLED: 'false',
      LLM_CACHE_MODE: 'replay',
      SMTP_URL: '',
      MAIL_CAPTURE_DIR: mailDir,
      MAIL_OUTBOX: 'off',
      IMAP_URL: '',
      RETENTION_JOB: 'off',
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-orgs-key-')), 'settings.key'),
      APP_URL: base,
      ADMIN_EMAILS: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  pool = new pg.Pool({ connectionString: testUrl });
  repo = new ShipmentsRepository(pool);
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not start');
});

after(async () => {
  api?.kill();
  idpServer?.close();
  await pool?.end();
});

describe('organizations', () => {
  it('gives every account a personal organization where it is owner', async () => {
    const a = await signUp('Personal');
    const { body } = await call('GET', '/orgs', undefined, a.cookie);
    assert.equal(body.items.length, 1);
    assert.deepEqual([body.active.name, body.active.personal, body.active.role], ['Personal', true, 'owner']);
    assert.ok(body.active.permissions.includes('org.delete'));
  });

  it('never lets a member of one organization read or change another organization’s data', async () => {
    const a = await signUp('Alice');
    const b = await signUp('Bob');
    const { s, fp } = await shipmentWithFinding(a.cookie);
    // An extracted invoice, so the shipment has companies and products.
    const docId = randomUUID();
    await repo.insertDocument({ id: docId, shipmentId: s.id, fileName: 'invoice.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(docId, { pageCount: 1, detectedType: 'COMMERCIAL_INVOICE', typeConfidence: 1 }, { documentId: docId, documentType: 'COMMERCIAL_INVOICE', model: 'test', promptVersion: 'test', raw: {}, data: sampleInvoice, issues: [], pdfLines: [] });
    const routes = [
      ['GET', `/shipments/${s.id}`],
      ['PATCH', `/shipments/${s.id}`, { reference: 'stolen' }],
      ['DELETE', `/shipments/${s.id}`],
      ['GET', `/shipments/${s.id}/validation`],
      ['GET', `/shipments/${s.id}/validations`],
      ['GET', `/shipments/${s.id}/findings`],
      ['GET', `/shipments/${s.id}/documents/${docId}`],
      ['GET', `/shipments/${s.id}/isf`],
      ['POST', `/shipments/${s.id}/validate?agent=false`],
      ['POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'open' }],
      ['GET', `/shipments/${s.id}/collab`],
      ['GET', `/shipments/${s.id}/comments`],
      ['POST', `/shipments/${s.id}/comments`, { targetKind: 'shipment', body: 'hello' }],
      ['PUT', `/shipments/${s.id}/assignee`, { userId: b.id }],
      ['PUT', `/shipments/${s.id}/schedule`, { eta: '2030-01-01' }],
      ['GET', `/shipments/${s.id}/shares`],
      ['GET', `/shipments/${s.id}/events`],
      ['GET', `/review/documents/${docId}`],
      ['POST', `/review/documents/${docId}/accept`, { paths: ['/invoiceNumber'] }],
      ['DELETE', `/review/documents/${docId}/accept`],
      ['GET', `/shipments/${s.id}/exports/cargowise-xml`],
      ['GET', `/shipments/${s.id}/tracking`],
    ];
    for (const [method, path, body] of routes) assert.equal((await call(method, path, body, b.cookie)).status, 404, `${method} ${path}`);
    assert.equal((await call('GET', '/shipments', undefined, b.cookie)).body.total, 0);
    assert.equal((await call('GET', '/shipments/alerts', undefined, b.cookie)).body.total, 0);
    assert.equal((await call('GET', '/insights/shipments', undefined, b.cookie)).body.total, 0);
    assert.equal((await call('GET', '/insights/parties', undefined, b.cookie)).body.total, 0);
    assert.deepEqual((await call('GET', `/events/labels?shipments=${s.id}`, undefined, b.cookie)).body.shipments, []);
    assert.equal((await call('POST', '/mail/threads', { kind: 'conversation', shipmentId: s.id, to: ['x@example.com'], subject: 's', body: 'b' }, b.cookie)).status, 404);
    // Still there, unchanged, for its owner.
    assert.equal((await call('GET', `/shipments/${s.id}`, undefined, a.cookie)).body.reference, s.reference);
    // Switching to an organization one is not a member of is refused.
    const aOrg = (await call('GET', '/orgs', undefined, a.cookie)).body.active.id;
    assert.equal((await call('POST', `/orgs/${aOrg}/switch`, undefined, b.cookie)).status, 404);
    // Parties and products are per organization too.
    const aParties = (await call('GET', '/insights/parties', undefined, a.cookie)).body.items;
    assert.ok(aParties.length > 0);
    assert.equal((await call('GET', `/insights/parties/${aParties[0].id}`, undefined, a.cookie)).status, 200);
    assert.equal((await call('GET', `/insights/parties/${aParties[0].id}`, undefined, b.cookie)).status, 404);
    const aProducts = (await call('GET', '/insights/products', undefined, a.cookie)).body.items;
    assert.equal((await call('GET', `/insights/products/${aProducts[0].id}`, undefined, b.cookie)).status, 404);
    assert.equal((await call('GET', '/insights/lines', undefined, b.cookie)).body.total, 0);
    // The review queue, supplier examples and usage are per organization too.
    assert.equal((await call('GET', `/review/documents/${docId}`, undefined, a.cookie)).status, 200);
    assert.equal((await call('GET', '/review/queue', undefined, b.cookie)).body.total, 0);
    assert.deepEqual((await call('GET', '/suppliers/examples', undefined, b.cookie)).body.suppliers, []);
    assert.equal((await call('GET', '/usage', undefined, a.cookie)).body.meters.find((m) => m.kind === 'validation').used, 1);
    assert.equal((await call('GET', '/usage', undefined, b.cookie)).body.meters.find((m) => m.kind === 'validation').used, 0);
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${docId}/file`, undefined, b.cookie)).status, 404);
    // The Mexico, EU and UK destinations filter within the organization too.
    const eu = (await call('POST', '/shipments', { destination: 'EU', reference: 'EU-1' }, a.cookie)).body;
    assert.equal((await call('GET', '/shipments?destination=EU', undefined, a.cookie)).body.total, 1);
    assert.equal((await call('GET', '/shipments?destination=EU', undefined, b.cookie)).body.total, 0);
    assert.equal((await call('PATCH', `/shipments/${eu.id}`, { destination: 'GB' }, b.cookie)).status, 404);
    assert.equal((await call('GET', `/shipments/${eu.id}`, undefined, a.cookie)).body.destination, 'EU');
    // The public API: a key of B's organization reaches none of A's shipments.
    const bKey = (await call('POST', '/integrations/api-keys', { name: 'B', scopes: ['read', 'write'] }, b.cookie)).body.key;
    const v1 = (method, path, body) =>
      fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${bKey}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) }).then((res) => res.status);
    for (const [method, path, body] of [
      ['GET', `/shipments/${s.id}`],
      ['GET', `/shipments/${s.id}/findings`],
      ['GET', `/shipments/${s.id}/documents/${docId}`],
      ['POST', `/shipments/${s.id}/validate`],
      ['GET', `/shipments/${s.id}/exports/x12-856`],
      ['POST', `/shipments/${s.id}/exports/x12-856/send`, { connector: 'mock' }],
    ]) assert.equal(await v1(method, path, body), 404, `api/v1 ${method} ${path}`);
    assert.equal((await (await fetch(`${base}/api/v1/shipments`, { headers: { authorization: `Bearer ${bKey}` } })).json()).total, 0);
  });

  it('lets only owners and admins manage integrations, and makes API keys act in their organization', async () => {
    const owner = await signUp('Integrator');
    await call('POST', '/orgs', { name: 'Keys Inc' }, owner.cookie);
    const created = await call('POST', '/integrations/api-keys', { name: 'ERP', scopes: ['read', 'write'] }, owner.cookie);
    assert.equal(created.status, 201);
    assert.equal(created.body.createdBy, 'Integrator');
    const admin = await signUp('Admin');
    const viewer = await signUp('Viewer');
    const client = await signUp('Client');
    const analyst = await signUp('Analyst2');
    await join_(owner, admin, 'admin');
    await join_(owner, viewer, 'viewer');
    await join_(owner, client, 'client');
    await join_(owner, analyst, 'analyst');
    for (const who of [viewer, client, analyst]) {
      for (const [method, path, body] of [
        ['GET', '/integrations/api-keys'],
        ['POST', '/integrations/api-keys', { name: 'x', scopes: ['read'] }],
        ['POST', `/integrations/api-keys/${created.body.id}/revoke`],
        ['GET', '/integrations/webhooks'],
        ['POST', '/integrations/webhooks', { url: 'https://example.com/hook', events: ['finding.created'] }],
        ['GET', '/integrations/chat-alerts'],
        ['GET', '/integrations/ingestion'],
        ['PUT', '/integrations/tracking', { enabled: true, provider: 'mock' }],
      ]) assert.equal((await call(method, path, body, who.cookie)).status, 403, `${who.name} ${method} ${path}`);
    }
    assert.equal((await call('GET', '/integrations/api-keys', undefined, admin.cookie)).body.length, 1);

    // A shipment made with the key belongs to the organization, recorded as created by the key's maker.
    const res = await fetch(`${base}/api/v1/shipments`, { method: 'POST', headers: { authorization: `Bearer ${created.body.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ reference: 'BY-KEY', destination: 'CA' }) });
    assert.equal(res.status, 201);
    const viaKey = await res.json();
    assert.equal((await call('GET', `/shipments/${viaKey.id}`, undefined, viewer.cookie)).body.reference, 'BY-KEY');
    const row = (await pool.query('select s.user_id, o.name from shipments s join organizations o on o.id = s.org_id where s.id = $1', [viaKey.id])).rows[0];
    assert.deepEqual([row.user_id, row.name], [owner.id, 'Keys Inc']);

    // Key changes are in the audit log, without the key.
    await call('POST', `/integrations/api-keys/${created.body.id}/revoke`, undefined, admin.cookie);
    const log = (await pool.query(`select action, user_email as actor_email, after::text as after from audit_log where action like 'api_key.%' or (action = 'shipment.create' and entity_id = $1) order by id`, [viaKey.id])).rows;
    assert.deepEqual(log.filter((l) => l.action.startsWith('api_key.')).map((l) => l.action).slice(-2), ['api_key.create', 'api_key.revoke']);
    assert.ok(log.every((l) => !l.after?.includes(created.body.key)));
    assert.match(log.find((l) => l.action === 'shipment.create').actor_email, /^api-key dck_/);
  });

  it('invites members by email, shares the organization’s shipments and keeps personal ones apart', async () => {
    const owner = await signUp('Owner');
    const mine = (await call('POST', '/shipments', { reference: 'personal-of-owner' }, owner.cookie)).body;
    const created = await call('POST', '/orgs', { name: 'Acme Imports' }, owner.cookie);
    assert.equal(created.status, 201);
    const team = (await call('POST', '/shipments', { reference: 'team-shipment' }, owner.cookie)).body;

    const analyst = await signUp('Analyst');
    // An invitation works only for the address it was sent to.
    const stranger = await signUp('Stranger');
    await call('POST', '/orgs/current/invites', { email: analyst.email, role: 'analyst' }, owner.cookie);
    const mail = await waitForMail((m) => m.to === analyst.email);
    assert.match(mail.subject, /Owner invited you to Acme Imports/);
    const token = /token=([\w-]+)/.exec(mail.text)[1];
    assert.deepEqual((await call('GET', `/orgs/invites/${token}`)).body, { orgName: 'Acme Imports', role: 'analyst', emailDomain: 'example.com' });
    assert.equal((await call('POST', '/orgs/invites/accept', { token }, stranger.cookie)).status, 403);
    assert.equal((await call('POST', '/orgs/invites/accept', { token }, analyst.cookie)).status, 200);
    assert.equal((await call('POST', '/orgs/invites/accept', { token }, analyst.cookie)).status, 404); // used up

    const orgs = (await call('GET', '/orgs', undefined, analyst.cookie)).body;
    assert.deepEqual([orgs.active.name, orgs.active.role, orgs.items.length], ['Acme Imports', 'analyst', 2]);
    const refs = (await call('GET', '/shipments', undefined, analyst.cookie)).body.items.map((x) => x.reference);
    assert.deepEqual(refs, ['team-shipment']);
    assert.equal((await call('GET', `/shipments/${mine.id}`, undefined, analyst.cookie)).status, 404);
    // Members of the organization see each other; the analyst works on the team's shipment.
    assert.deepEqual((await call('GET', '/orgs/current/members', undefined, analyst.cookie)).body.map((m) => m.role), ['owner', 'analyst']);
    assert.equal((await call('PATCH', `/shipments/${team.id}`, { reference: 'team-shipment-2' }, analyst.cookie)).status, 200);
    // Back in their personal organization, the team's shipments are not listed.
    const personal = orgs.items.find((o) => o.personal);
    assert.equal((await call('POST', `/orgs/${personal.id}/switch`, undefined, analyst.cookie)).status, 200);
    assert.equal((await call('GET', '/shipments', undefined, analyst.cookie)).body.total, 0);
    assert.equal((await call('GET', `/shipments/${team.id}`, undefined, analyst.cookie)).status, 404);
  });

  it('checks each role’s permissions in one place', async () => {
    const owner = await signUp('Boss');
    await call('POST', '/orgs', { name: 'Roles Co' }, owner.cookie);
    const { s, fp } = await shipmentWithFinding(owner.cookie);
    const viewer = await signUp('Viewer');
    const admin = await signUp('Admin');
    await join_(owner, viewer, 'viewer');
    await join_(owner, admin, 'admin');

    assert.equal((await call('GET', `/shipments/${s.id}`, undefined, viewer.cookie)).status, 200);
    assert.equal((await call('GET', '/insights/summary', undefined, viewer.cookie)).status, 200);
    assert.equal((await call('POST', '/shipments', { destination: 'CA' }, viewer.cookie)).status, 403);
    assert.equal((await call('PATCH', `/shipments/${s.id}`, { reference: 'x' }, viewer.cookie)).status, 403);
    assert.equal((await call('POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'open' }, viewer.cookie)).status, 403);
    assert.equal((await call('POST', `/shipments/${s.id}/comments`, { targetKind: 'shipment', body: 'hi' }, viewer.cookie)).status, 403);
    assert.equal((await call('GET', '/audit', undefined, viewer.cookie)).status, 403);
    assert.equal((await call('POST', '/orgs/current/invites', { email: 'x@example.com', role: 'viewer' }, viewer.cookie)).status, 403);
    // Viewers read the review queue and usage, but neither review values nor buy a plan.
    assert.equal((await call('GET', '/review/queue', undefined, viewer.cookie)).status, 200);
    assert.equal((await call('GET', '/usage', undefined, viewer.cookie)).status, 200);
    assert.equal((await call('POST', `/review/documents/${randomUUID()}/accept`, { paths: ['/invoiceNumber'] }, viewer.cookie)).status, 403);
    assert.equal((await call('DELETE', '/suppliers/examples/ACME', undefined, viewer.cookie)).status, 403);
    assert.equal((await call('POST', '/billing/checkout', { plan: 'pro' }, viewer.cookie)).status, 403);
    assert.equal((await call('POST', '/billing/portal', undefined, viewer.cookie)).status, 403);
    // An admin may manage billing (here it is not set up: 503, not 403).
    assert.notEqual((await call('POST', '/billing/checkout', { plan: 'pro' }, admin.cookie)).status, 403);

    // An admin manages members but cannot make owners; the last owner cannot step down.
    assert.equal((await call('PATCH', `/orgs/current/members/${viewer.id}`, { role: 'reviewer' }, admin.cookie)).status, 200);
    assert.equal((await call('PATCH', `/orgs/current/members/${viewer.id}`, { role: 'owner' }, admin.cookie)).status, 403);
    assert.equal((await call('PATCH', `/orgs/current/members/${owner.id}`, { role: 'admin' }, admin.cookie)).status, 403);
    assert.equal((await call('PATCH', `/orgs/current/members/${owner.id}`, { role: 'admin' }, owner.cookie)).status, 409);
    assert.equal((await call('DELETE', `/orgs/current/members/${owner.id}`, undefined, owner.cookie)).status, 409);
    // Nor can the account be deleted while it is the only owner of a team.
    assert.equal((await call('DELETE', '/auth/me', { password: 'correct horse battery' }, owner.cookie)).status, 409);
    // A member can leave.
    assert.equal((await call('DELETE', `/orgs/current/members/${viewer.id}`, undefined, viewer.cookie)).status, 204);
    assert.equal((await call('GET', `/shipments/${s.id}`, undefined, viewer.cookie)).status, 404);
  });

  it('lets a client read only the shipments shared with them', async () => {
    const owner = await signUp('Forwarder');
    await call('POST', '/orgs', { name: 'Forwarding Ltd' }, owner.cookie);
    const shared = (await call('POST', '/shipments', { reference: 'for-the-client' }, owner.cookie)).body;
    const other = (await call('POST', '/shipments', { reference: 'internal' }, owner.cookie)).body;
    const client = await signUp('Client');
    await join_(owner, client, 'client');
    const viewer = await signUp('Not a client');
    await join_(owner, viewer, 'viewer');
    assert.equal((await call('POST', `/shipments/${shared.id}/shares`, { userId: viewer.id }, owner.cookie)).status, 400);

    assert.equal((await call('GET', '/shipments', undefined, client.cookie)).body.total, 0);
    assert.equal((await call('POST', `/shipments/${shared.id}/shares`, { userId: client.id }, owner.cookie)).status, 200);
    const list = (await call('GET', '/shipments', undefined, client.cookie)).body;
    assert.deepEqual(list.items.map((x) => x.reference), ['for-the-client']);
    assert.equal(list.summary.all, 1);
    assert.equal((await call('GET', `/shipments/${shared.id}`, undefined, client.cookie)).status, 200);
    assert.equal((await call('GET', `/shipments/${shared.id}/collab`, undefined, client.cookie)).status, 200);
    assert.equal((await call('GET', `/shipments/${other.id}`, undefined, client.cookie)).status, 404);
    for (const path of ['/insights/summary', '/shipments/alerts', '/orgs/current/members', '/mail/threads', `/shipments/${shared.id}/comments`, '/events/labels', '/review/queue', '/review/summary', '/suppliers/examples', '/usage']) {
      assert.equal((await call('GET', path, undefined, client.cookie)).status, 403, path);
    }
    assert.equal((await call('PATCH', `/shipments/${shared.id}`, { reference: 'x' }, client.cookie)).status, 403);
    assert.equal((await call('DELETE', `/shipments/${shared.id}/shares/${client.id}`, undefined, owner.cookie)).status, 200);
    assert.equal((await call('GET', `/shipments/${shared.id}`, undefined, client.cookie)).status, 404);
  });
});

describe('collaboration', () => {
  it('assigns findings and shipments, and tells the assignee in the app and by email', async () => {
    const owner = await signUp('Lead');
    await call('POST', '/orgs', { name: 'Assign Co' }, owner.cookie);
    const analyst = await signUp('Worker');
    await join_(owner, analyst, 'analyst');
    const viewer = await signUp('Watcher');
    await join_(owner, viewer, 'viewer');
    const { s, fp } = await shipmentWithFinding(owner.cookie);

    assert.equal((await call('PUT', `/shipments/${s.id}/findings/assignee`, { fingerprints: [fp], userId: viewer.id }, owner.cookie)).status, 400);
    const res = await call('PUT', `/shipments/${s.id}/findings/assignee`, { fingerprints: [fp], userId: analyst.id }, owner.cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.findingAssignees[fp], { id: analyst.id, name: 'Worker' });
    await call('PUT', `/shipments/${s.id}/assignee`, { userId: analyst.id }, owner.cookie);

    const notes = (await call('GET', '/notifications', undefined, analyst.cookie)).body;
    assert.equal(notes.unread, 2);
    assert.deepEqual(notes.items.map((n) => [n.kind, n.shipmentId, n.actorName]), [['assignment', s.id, 'Lead'], ['assignment', s.id, 'Lead']]);
    const mail = await waitForMail((m) => m.to === analyst.email && /assigned you/.test(m.subject));
    assert.ok(mail.text.includes(`${base}/#/app/s/${s.id}`));
    const list = (await call('GET', '/shipments?assignee=me', undefined, analyst.cookie)).body;
    assert.deepEqual(list.items.map((x) => [x.id, x.assignee?.name]), [[s.id, 'Worker']]);
    assert.equal((await call('POST', '/notifications/read', { ids: 'all' }, analyst.cookie)).status, 204);
    assert.equal((await call('GET', '/notifications', undefined, analyst.cookie)).body.unread, 0);

    // Preferences: no more emails for assignments.
    const before = mails().length;
    assert.equal((await call('PUT', '/notifications/prefs', { assignment: { inApp: true, email: false } }, analyst.cookie)).status, 200);
    await call('PUT', `/shipments/${s.id}/assignee`, { userId: analyst.id }, owner.cookie);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(mails().filter((m, i) => i >= before && m.to === analyst.email).length, 0);
    assert.equal((await call('GET', '/notifications', undefined, analyst.cookie)).body.unread, 1);
  });

  it('keeps comments with @mentions on findings and documents', async () => {
    const owner = await signUp('Commenter');
    await call('POST', '/orgs', { name: 'Comment Co' }, owner.cookie);
    const reviewer = await signUp('Mentioned');
    await join_(owner, reviewer, 'reviewer');
    const outsider = await signUp('Outsider');
    const { s, fp } = await shipmentWithFinding(owner.cookie);

    const res = await call('POST', `/shipments/${s.id}/comments`, { targetKind: 'finding', targetId: fp, body: '@Mentioned can you check the B/L count?', mentions: [reviewer.id, outsider.id] }, owner.cookie);
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.map((c) => [c.author.name, c.mentions.map((m) => m.name)]), [['Commenter', ['Mentioned']]]);
    assert.equal((await call('POST', `/shipments/${s.id}/comments`, { targetKind: 'finding', targetId: '0'.repeat(32), body: 'x' }, owner.cookie)).status, 400);
    assert.equal((await call('POST', `/shipments/${s.id}/comments`, { targetKind: 'document', targetId: randomUUID(), body: 'x' }, owner.cookie)).status, 400);

    const note = (await call('GET', '/notifications', undefined, reviewer.cookie)).body.items[0];
    assert.deepEqual([note.kind, note.detail.targetId, note.detail.excerpt], ['mention', fp, '@Mentioned can you check the B/L count?']);
    assert.equal((await call('GET', '/notifications', undefined, outsider.cookie)).body.unread, 0);

    // The reviewer answers; only the author edits; an admin can remove.
    await call('POST', `/shipments/${s.id}/comments`, { targetKind: 'finding', targetId: fp, body: 'Checked: one pallet is a spare' }, reviewer.cookie);
    const thread = (await call('GET', `/shipments/${s.id}/comments?targetKind=finding&targetId=${fp}`, undefined, owner.cookie)).body;
    assert.equal(thread.length, 2);
    assert.equal((await call('PATCH', `/shipments/${s.id}/comments/${thread[1].id}`, { body: 'hijacked' }, owner.cookie)).status, 403);
    assert.equal((await call('PATCH', `/shipments/${s.id}/comments/${thread[1].id}`, { body: 'Checked: one spare pallet' }, reviewer.cookie)).status, 200);
    assert.equal((await call('DELETE', `/shipments/${s.id}/comments/${thread[1].id}`, undefined, owner.cookie)).status, 204);
    const after_ = (await call('GET', `/shipments/${s.id}/comments`, undefined, owner.cookie)).body;
    assert.deepEqual(after_.map((c) => [c.deleted, c.body]), [[false, '@Mentioned can you check the B/L count?'], [true, '']]);
    assert.equal((await call('GET', `/shipments/${s.id}/collab`, undefined, owner.cookie)).body.commentCounts[`finding:${fp}`], 1);
  });

  it('needs a second person to approve an accepted risk or false positive when the organization asks for it', async () => {
    const owner = await signUp('Approver Owner');
    await call('POST', '/orgs', { name: 'Two Step Co' }, owner.cookie);
    assert.equal((await call('PATCH', '/orgs/current', { requireApproval: true }, owner.cookie)).body.requireApproval, true);
    const analyst = await signUp('Requester');
    const reviewer = await signUp('Second Pair');
    await join_(owner, analyst, 'analyst');
    await join_(owner, reviewer, 'reviewer');
    const { s, fp } = await shipmentWithFinding(owner.cookie);

    const asked = await call('POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'accepted', note: 'Spare pallet, agreed with broker' }, analyst.cookie);
    assert.equal(asked.status, 200);
    assert.equal(asked.body.findings[0].review, undefined); // not decided yet
    const collab = (await call('GET', `/shipments/${s.id}/collab`, undefined, owner.cookie)).body;
    assert.equal(collab.pendingApprovals.length, 1);
    const request = collab.pendingApprovals[0];
    assert.deepEqual([request.status, request.requestedBy.name], ['accepted', 'Requester']);
    assert.equal((await call('GET', '/notifications', undefined, reviewer.cookie)).body.items[0].kind, 'approval_requested');
    assert.equal((await call('GET', '/approvals', undefined, reviewer.cookie)).body.length, 1);

    // The analyst cannot approve; the owner's own request needs someone else.
    assert.equal((await call('POST', `/shipments/${s.id}/approvals/${request.id}`, { decision: 'approved' }, analyst.cookie)).status, 403);
    assert.equal((await call('POST', `/shipments/${s.id}/approvals/${request.id}`, { decision: 'rejected' }, reviewer.cookie)).status, 400); // a rejection says why
    assert.equal((await call('POST', `/shipments/${s.id}/approvals/${request.id}`, { decision: 'approved', note: 'OK' }, reviewer.cookie)).status, 200);
    assert.equal((await call('POST', `/shipments/${s.id}/approvals/${request.id}`, { decision: 'approved' }, owner.cookie)).status, 409);
    const decided = (await call('GET', `/shipments/${s.id}/validation`, undefined, owner.cookie)).body.findings[0];
    assert.deepEqual([decided.review.status, decided.review.userName], ['accepted', 'Requester']);
    const approvedBy = (await pool.query('select approved_by from finding_reviews where shipment_id = $1', [s.id])).rows[0].approved_by;
    assert.equal(approvedBy, reviewer.id);
    assert.equal((await call('GET', '/notifications', undefined, analyst.cookie)).body.items[0].kind, 'approval_decided');

    // An owner asking needs another reviewer too.
    await call('POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'false_positive', note: 'Count read wrong' }, owner.cookie);
    const own = (await call('GET', `/shipments/${s.id}/collab`, undefined, owner.cookie)).body.pendingApprovals[0];
    assert.equal((await call('POST', `/shipments/${s.id}/approvals/${own.id}`, { decision: 'approved' }, owner.cookie)).status, 403);
    // Going back to open withdraws what was pending.
    await call('POST', `/shipments/${s.id}/findings/review`, { fingerprints: [fp], status: 'open' }, owner.cookie);
    assert.equal((await call('GET', `/shipments/${s.id}/collab`, undefined, owner.cookie)).body.pendingApprovals.length, 0);
  });

  it('computes due dates and filters overdue shipments', async () => {
    const owner = await signUp('Scheduler');
    const late = (await call('POST', '/shipments', { destination: 'CA', reference: 'late' }, owner.cookie)).body;
    const soon = (await call('POST', '/shipments', { destination: 'CA', reference: 'soon' }, owner.cookie)).body;
    await call('POST', '/shipments', { destination: 'CA', reference: 'no date' }, owner.cookie);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const res = await call('PUT', `/shipments/${late.id}/schedule`, { eta: yesterday }, owner.cookie);
    assert.equal(res.body.due.source, 'eta');
    assert.equal(res.body.eta, yesterday);
    await call('PUT', `/shipments/${soon.id}/schedule`, { dueAt: new Date(Date.now() + 3600_000).toISOString() }, owner.cookie);
    const overdue = (await call('GET', '/shipments?due=overdue', undefined, owner.cookie)).body;
    assert.deepEqual(overdue.items.map((x) => [x.reference, x.overdue, x.dueSource]), [['late', true, 'eta']]);
    assert.deepEqual([overdue.summary.overdue, overdue.summary.dueSoon], [1, 1]);
    assert.deepEqual((await call('GET', '/shipments?due=soon', undefined, owner.cookie)).body.items.map((x) => [x.reference, x.dueSource]), [['soon', 'manual']]);
    // A US ocean shipment is due 24 hours before lading (the ISF deadline), from the B/L's on-board date.
    const us = (await call('POST', '/shipments', { destination: 'US', transportMode: 'SEA', reference: 'isf' }, owner.cookie)).body;
    const docId = randomUUID();
    await pool.query(`insert into documents (id, shipment_id, file_name, storage_key, sha256, page_count, detected_type, type_confidence, status) values ($1, $2, 'bl.pdf', 'none', '0', 1, 'BILL_OF_LADING', 1, 'EXTRACTED')`, [docId, us.id]);
    await pool.query(`insert into bills_of_lading (document_id, shipment_id, shipped_on_board_date) values ($1, $2, '2031-03-10')`, [docId, us.id]);
    const isf = (await call('GET', `/shipments/${us.id}/collab`, undefined, owner.cookie)).body.due;
    assert.deepEqual(isf, { at: '2031-03-09T00:00:00.000Z', source: 'isf' });
  });
});

describe('audit log', () => {
  it('records every write with who, what, before and after, in a chain that detects tampering', async () => {
    const owner = await signUp('Auditor');
    await call('POST', '/orgs', { name: 'Audit Co' }, owner.cookie);
    const s = (await call('POST', '/shipments', { destination: 'CA', reference: 'audited' }, owner.cookie)).body;
    await call('PATCH', `/shipments/${s.id}`, { reference: 'audited-2' }, owner.cookie);
    await call('POST', '/mail/preview', { subject: 'x', body: 'y' }, owner.cookie); // a write no service describes

    const { body: page } = await call('GET', '/audit?limit=200', undefined, owner.cookie);
    const actions = page.items.map((r) => r.action);
    for (const a of ['org.create', 'shipment.create', 'shipment.update', 'http.post']) assert.ok(actions.includes(a), a);
    const update = page.items.find((r) => r.action === 'shipment.update');
    assert.deepEqual([update.before.reference, update.after.reference, update.userEmail, update.entityId], ['audited', 'audited-2', owner.email, s.id]);
    assert.ok(update.ip);
    assert.equal((await call('GET', `/audit?action=shipment.&entityId=${s.id}`, undefined, owner.cookie)).body.total, 2);

    // Passwords never reach the log.
    await call('POST', '/auth/password', { currentPassword: 'correct horse battery', newPassword: 'another long password' }, owner.cookie);
    const all = await pool.query('select before::text || after::text as t from audit_log');
    assert.ok(all.rows.every((r) => !r.t?.includes('another long password')));

    const csv = await fetch(`${base}/audit/log.csv?action=shipment.`, { headers: { cookie: owner.cookie } });
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const bytes = new Uint8Array(await csv.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // the UTF-8 BOM, for Excel
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).slice(1);
    assert.match(text, /^ID,Time \(UTC\),User,/);
    assert.ok(text.includes('shipment.update'));

    assert.deepEqual((await call('GET', '/audit/verify', undefined, owner.cookie)).body.intact, true);
    await assert.rejects(pool.query('update audit_log set action = $1 where id = $2', ['x', update.id]), /append-only/);
    await assert.rejects(pool.query('delete from audit_log where id = $1', [update.id]), /append-only/);
    // Someone with the database owner's rights could still drop the trigger and edit a row: the chain says where.
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('alter table audit_log disable trigger audit_log_append_only');
      await client.query(`update audit_log set after = '{"reference":"forged"}' where id = $1`, [update.id]);
      await client.query('alter table audit_log enable trigger audit_log_append_only');
      await client.query('commit');
    } finally {
      client.release();
    }
    const verified = (await call('GET', '/audit/verify', undefined, owner.cookie)).body;
    assert.deepEqual([verified.intact, verified.firstBroken], [false, update.id]);
  });

  it('deletes only what is past the retention period, and records it', async () => {
    const owner = await signUp('Retainer');
    await call('POST', '/orgs', { name: 'Retention Co' }, owner.cookie);
    const make = async (destination, yearsAgo) => {
      const s = (await call('POST', '/shipments', { destination, reference: `${destination}-${yearsAgo}` }, owner.cookie)).body;
      await pool.query(`update shipments set created_at = now() - make_interval(days => $2) where id = $1`, [s.id, Math.round(yearsAgo * 365.25)]);
      return s;
    };
    const ca7 = await make('CA', 7);
    const ca55 = await make('CA', 5.5);
    const us55 = await make('US', 5.5);
    const us4 = await make('US', 4);
    assert.deepEqual((await call('GET', '/orgs/current/retention', undefined, owner.cookie)).body, { expired: 2 });
    const run = await call('POST', '/orgs/current/retention/run', undefined, owner.cookie);
    assert.deepEqual(run.body, { deleted: 2, skipped: 0 });
    const left = (await call('GET', '/shipments', undefined, owner.cookie)).body.items.map((x) => x.id).sort();
    assert.deepEqual(left, [ca55.id, us4.id].sort());
    const audit = (await call('GET', '/audit?action=retention.delete', undefined, owner.cookie)).body.items;
    assert.deepEqual(audit.map((r) => r.entityId).sort(), [ca7.id, us55.id].sort());
    assert.equal(audit[0].before.documents, 0);
    // Longer periods keep more.
    await call('PATCH', '/orgs/current', { retentionUsYears: 10 }, owner.cookie);
    assert.deepEqual((await call('GET', '/orgs/current/retention', undefined, owner.cookie)).body, { expired: 0 });
  });

  it('keeps Mexico, EU and UK shipments for their own periods: 5, 3 and 4 years by default', async () => {
    const owner = await signUp('Retainer Intl');
    await call('POST', '/orgs', { name: 'Retention Intl Co' }, owner.cookie);
    const periods = (await call('GET', '/orgs/current', undefined, owner.cookie)).body.settings;
    assert.deepEqual([periods.retentionMxYears, periods.retentionEuYears, periods.retentionGbYears], [5, 3, 4]);
    const make = async (destination, yearsAgo) => {
      const s = (await call('POST', '/shipments', { destination, reference: `${destination}-${yearsAgo}` }, owner.cookie)).body;
      await pool.query(`update shipments set created_at = now() - make_interval(days => $2) where id = $1`, [s.id, Math.round(yearsAgo * 365.25)]);
      return s;
    };
    const expired = [await make('MX', 5.5), await make('EU', 3.5), await make('GB', 4.5)];
    const kept = [await make('MX', 4.5), await make('EU', 2.5), await make('GB', 3.5)];
    const run = await call('POST', '/orgs/current/retention/run', undefined, owner.cookie);
    assert.deepEqual(run.body, { deleted: 3, skipped: 0 });
    const left = (await call('GET', '/shipments', undefined, owner.cookie)).body.items.map((x) => x.id).sort();
    assert.deepEqual(left, kept.map((x) => x.id).sort());
    const audit = (await call('GET', '/audit?action=retention.delete', undefined, owner.cookie)).body.items;
    assert.deepEqual(audit.map((r) => r.entityId).sort(), expired.map((x) => x.id).sort());
    // Each period is set on its own and checked like the others.
    assert.equal((await call('PATCH', '/orgs/current', { retentionEuYears: 2 }, owner.cookie)).status, 200);
    assert.deepEqual((await call('GET', '/orgs/current/retention', undefined, owner.cookie)).body, { expired: 1 });
    assert.equal((await call('PATCH', '/orgs/current', { retentionGbYears: 0 }, owner.cookie)).status, 400);
  });
});

describe('sign-in', () => {
  it('turns on TOTP two-factor sign-in with single-use recovery codes', async () => {
    const user = await signUp('Two Factor');
    const setup = (await call('POST', '/auth/mfa/setup', undefined, user.cookie)).body;
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\/DocCheck%3A/);
    assert.equal((await call('POST', '/auth/mfa/enable', { code: '000000' }, user.cookie)).status, 400);
    const enabled = await call('POST', '/auth/mfa/enable', { code: totp(setup.secret) }, user.cookie);
    assert.equal(enabled.body.recoveryCodes.length, 10);
    // The secret is sealed, never stored as is.
    const stored = (await pool.query('select mfa_secret::text as s from users where id = $1', [user.id])).rows[0].s;
    assert.ok(!stored.includes(setup.secret));

    const login = await call('POST', '/auth/login', { email: user.email, password: 'correct horse battery' });
    assert.deepEqual([login.status, login.body.mfaRequired, login.cookie], [200, true, '']);
    assert.equal((await call('POST', '/auth/mfa', { ticket: login.body.ticket, code: '123456' })).status, 401);
    // The code already used to enable it cannot be used again; the next one works.
    const next = hotp(base32Decode(setup.secret), totpCounter(Date.now()) + 1);
    const ok = await call('POST', '/auth/mfa', { ticket: login.body.ticket, code: next });
    assert.equal(ok.status, 200);
    assert.equal((await call('GET', '/auth/me', undefined, ok.cookie)).body.id, user.id);
    const again = await call('POST', '/auth/login', { email: user.email, password: 'correct horse battery' });
    assert.equal((await call('POST', '/auth/mfa', { ticket: again.body.ticket, code: next })).status, 401); // replay
    const recovery = enabled.body.recoveryCodes[0];
    assert.equal((await call('POST', '/auth/mfa', { ticket: again.body.ticket, code: recovery.toUpperCase() })).status, 200);
    const third = await call('POST', '/auth/login', { email: user.email, password: 'correct horse battery' });
    assert.equal((await call('POST', '/auth/mfa', { ticket: third.body.ticket, code: recovery })).status, 401);
    assert.deepEqual((await call('GET', '/auth/mfa', undefined, user.cookie)).body, { enabled: true, recoveryCodesLeft: 9 });
    assert.equal((await call('POST', '/auth/mfa/disable', { password: 'wrong', code: enabled.body.recoveryCodes[1] }, user.cookie)).status, 401);
    assert.equal((await call('POST', '/auth/mfa/disable', { password: 'correct horse battery', code: enabled.body.recoveryCodes[1] }, user.cookie)).status, 204);
    assert.equal((await call('POST', '/auth/login', { email: user.email, password: 'correct horse battery' })).body.mfaRequired, undefined);
  });

  it('lists sessions and signs one out', async () => {
    const user = await signUp('Sessions');
    const second = (await call('POST', '/auth/login', { email: user.email, password: 'correct horse battery' })).cookie;
    const list = (await call('GET', '/auth/sessions', undefined, user.cookie)).body;
    assert.equal(list.length, 2);
    assert.equal(list.filter((x) => x.current).length, 1);
    const other = list.find((x) => !x.current);
    assert.equal(other.method, 'password');
    assert.equal((await call('DELETE', `/auth/sessions/${other.id}`, undefined, user.cookie)).status, 204);
    assert.equal((await call('GET', '/auth/me', undefined, second)).status, 401);
    assert.equal((await call('GET', '/auth/me', undefined, user.cookie)).status, 200);
    // Nobody signs out someone else's session.
    const stranger = await signUp('Session thief');
    const mine = (await call('GET', '/auth/sessions', undefined, user.cookie)).body[0];
    assert.equal((await call('DELETE', `/auth/sessions/${mine.id}`, undefined, stranger.cookie)).status, 404);
  });

  it('signs in through the organization’s OpenID Connect provider', async () => {
    const owner = await signUp('SSO Admin');
    const org = (await call('POST', '/orgs', { name: 'SSO Co' }, owner.cookie)).body;
    const config = { enabled: true, issuer, clientId: 'doccheck', clientSecret: 'idp-secret', emailDomains: ['sso.example'], defaultRole: 'analyst' };
    assert.equal((await call('PUT', '/orgs/current/sso', { ...config, issuer: 'http://localhost:1' }, owner.cookie)).status, 400);
    const saved = await call('PUT', '/orgs/current/sso', config, owner.cookie);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.redirectUri, `${base}/auth/sso/callback`);
    assert.ok(!JSON.stringify((await pool.query('select client_secret from org_sso')).rows).includes('idp-secret'));
    assert.deepEqual((await call('GET', '/auth/sso/discover?email=ana@sso.example')).body, { sso: true, orgId: org.id, orgName: 'SSO Co' });
    assert.deepEqual((await call('GET', '/auth/sso/discover?email=ana@other.example')).body, { sso: false });

    const signIn = async (email) => {
      idp.email = email;
      const start = await call('GET', `/auth/sso/${org.id}/start?login_hint=${email}`);
      assert.equal(start.status, 302);
      const authorize = new URL(start.headers.get('location'));
      assert.equal(authorize.origin, issuer);
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      const back = await fetch(authorize, { redirect: 'manual' });
      const callback = await call('GET', new URL(back.headers.get('location')).pathname + new URL(back.headers.get('location')).search);
      return callback;
    };
    const ok = await signIn('ana@sso.example');
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), `${base}/#/app`);
    const me = (await call('GET', '/auth/me', undefined, ok.cookie)).body;
    assert.equal(me.email, 'ana@sso.example');
    const orgs = (await call('GET', '/orgs', undefined, ok.cookie)).body;
    assert.deepEqual([orgs.active.id, orgs.active.role], [org.id, 'analyst']);
    assert.equal((await call('GET', '/auth/sessions', undefined, ok.cookie)).body[0].method, 'sso');
    // A second sign-in finds the same account; a state cannot be used twice.
    assert.equal((await signIn('ana@sso.example')).status, 302);
    // Outside the domains, or an existing account that is not a member: refused.
    const wrong = await signIn('bob@elsewhere.example');
    assert.match(decodeURIComponent(wrong.headers.get('location')), /sso_error=.*not in the domains/);
    await call('POST', '/auth/register', { email: 'existing@sso.example', password: 'correct horse battery', name: 'Existing' });
    const existing = await signIn('existing@sso.example');
    assert.match(decodeURIComponent(existing.headers.get('location')), /sso_error=.*already exists/);
    idp.verified = false;
    assert.match(decodeURIComponent((await signIn('carl@sso.example')).headers.get('location')), /sso_error=.*did not vouch/);
    idp.verified = true;
    const replay = await call('GET', `/auth/sso/callback?code=x&state=y`);
    assert.match(decodeURIComponent(replay.headers.get('location')), /sso_error=/);
  });
});

describe('migration to organizations', () => {
  it('moves every account’s shipments, companies and conversations into a personal organization', async () => {
    await resetDatabase(migrationUrl);
    const dir = mkdtempSync(join(tmpdir(), 'doccheck-migrations-'));
    const all = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const before_ = all.filter((f) => f < '040_');
    for (const f of before_) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const p = new pg.Pool({ connectionString: migrationUrl });
    try {
      await migrate(p, dir);
      const user = randomUUID();
      const ship = randomUUID();
      await p.query(`insert into users (id, email, name, password_hash) values ($1, 'old@example.com', 'Old User', 'x')`, [user]);
      await p.query(`insert into shipments (id, reference, destination, status, user_id) values ($1, 'old shipment', 'CA', 'RECEIVED', $2)`, [ship, user]);
      await p.query(`insert into shipments (id, reference, status) values ($1, 'ownerless', 'RECEIVED')`, [randomUUID()]);
      await p.query(`insert into parties (id, user_id, key, name) values ($1, $2, 'acme', 'ACME')`, [randomUUID(), user]);
      await p.query(`insert into mail_threads (id, user_id, shipment_id, token, kind, subject) values ($1, $2, $3, 'tok123', 'conversation', 'hi')`, [randomUUID(), user, ship]);
      for (const f of all.filter((x) => !before_.includes(x))) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
      await migrate(p, dir);
      const org = (await p.query('select o.id, o.name, o.personal, m.role from organizations o join org_members m on m.org_id = o.id where m.user_id = $1', [user])).rows;
      assert.deepEqual(org.map((o) => [o.name, o.personal, o.role]), [['Old User', true, 'owner']]);
      const orgId = org[0].id;
      assert.equal((await p.query('select org_id from shipments where id = $1', [ship])).rows[0].org_id, orgId);
      assert.equal((await p.query(`select org_id from shipments where reference = 'ownerless'`)).rows[0].org_id, null);
      assert.equal((await p.query('select org_id from parties where user_id = $1', [user])).rows[0].org_id, orgId);
      assert.equal((await p.query('select org_id from mail_threads where user_id = $1', [user])).rows[0].org_id, orgId);
      assert.equal((await p.query('select last_org_id from users where id = $1', [user])).rows[0].last_org_id, orgId);
    } finally {
      await p.end();
    }
  });
});

describe('rule settings and purchase orders', () => {
  it('belong to the organization: members read them, owners and admins change settings, viewers and clients change nothing', async () => {
    const owner = await signUp('Rules owner');
    await call('POST', '/orgs', { name: 'Rules Co' }, owner.cookie);
    const analyst = await signUp('Rules analyst');
    const viewer = await signUp('Rules viewer');
    const client = await signUp('Rules client');
    const outsider = await signUp('Rules outsider');
    await join_(owner, analyst, 'analyst');
    await join_(owner, viewer, 'viewer');
    await join_(owner, client, 'client');

    const config = { rules: { X8: { enabled: false } }, params: { knownScacs: ['EXLN'] } };
    assert.equal((await call('PUT', '/rules/settings', config, owner.cookie)).status, 200);
    for (const m of [analyst, viewer]) assert.deepEqual((await call('GET', '/rules/settings', undefined, m.cookie)).body.config, config);
    for (const m of [analyst, viewer, client]) {
      assert.equal((await call('PUT', '/rules/settings', {}, m.cookie)).status, 403);
      assert.equal((await call('DELETE', '/rules/settings', undefined, m.cookie)).status, 403);
    }
    assert.equal((await call('GET', '/rules/settings', undefined, client.cookie)).status, 403);
    // Another organization has its own (none).
    assert.deepEqual((await call('GET', '/rules/settings', undefined, outsider.cookie)).body.config, {});

    // Purchase orders: analysts import, viewers and clients cannot, outsiders do not see them.
    const po = [{ poNumber: 'PO-4411', currency: 'USD', lines: [{ sku: 'TB-200', quantity: '6000', unit: 'PCS', unitPrice: '8.10' }] }];
    assert.equal((await call('POST', '/purchase-orders', po, viewer.cookie)).status, 403);
    assert.equal((await call('POST', '/purchase-orders', po, client.cookie)).status, 403);
    assert.equal((await call('POST', '/purchase-orders', po, analyst.cookie)).status, 201);
    const [order] = (await call('GET', '/purchase-orders', undefined, viewer.cookie)).body;
    assert.equal(order.poNumber, 'PO-4411');
    assert.equal((await call('GET', '/purchase-orders', undefined, client.cookie)).status, 403);
    assert.deepEqual((await call('GET', '/purchase-orders', undefined, outsider.cookie)).body, []);
    assert.equal((await call('DELETE', `/purchase-orders/${order.id}`, undefined, outsider.cookie)).status, 404);
    assert.equal((await call('DELETE', `/purchase-orders/${order.id}`, undefined, viewer.cookie)).status, 403);

    // A run in the organization applies its settings and matches its PO; the run records them.
    const { s } = await shipmentWithFinding(analyst.cookie);
    const run = (await call('GET', `/shipments/${s.id}/validation`, undefined, analyst.cookie)).body;
    assert.deepEqual(run.findings.map((f) => f.ruleId), ['X2']);
    assert.equal(run.ruleConfig.scope, 'organization');
    assert.deepEqual(run.ruleConfig.disabled, ['X8']);
    assert.equal(run.ruleConfig.account.purchaseOrder, 'PO-4411');
    assert.equal((await call('DELETE', `/purchase-orders/${order.id}`, undefined, analyst.cookie)).status, 204);
  });

  it('finds a duplicate invoice only among the organization’s own shipments', async () => {
    const a = await signUp('Dup A');
    const b = await signUp('Dup B');
    for (const m of [a, b]) await call('PUT', '/rules/settings', { params: { knownScacs: ['EXLN'] } }, m.cookie);
    // An earlier shipment of A with the same invoice, extracted (projected to the invoices table).
    const { body: first } = await call('POST', '/shipments', { destination: 'CA', reference: 'first' }, a.cookie);
    const docId = randomUUID();
    await repo.insertDocument({ id: docId, shipmentId: first.id, fileName: 'invoice.pdf', storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(docId, { pageCount: 1, detectedType: 'COMMERCIAL_INVOICE', typeConfidence: 1 }, { documentId: docId, documentType: 'COMMERCIAL_INVOICE', model: 'test', promptVersion: 'test', raw: {}, data: sampleInvoice, issues: [], pdfLines: [] });

    const docs = { invoice: sampleInvoice, packingList: samplePackingList, billOfLading: sampleBillOfLading };
    const again = (await call('POST', '/shipments', { destination: 'CA' }, a.cookie)).body;
    const mine = (await call('POST', `/shipments/${again.id}/validate?agent=false`, docs, a.cookie)).body;
    assert.deepEqual(mine.findings.map((f) => f.ruleId), ['X17']);
    assert.ok(mine.findings[0].evidence.some((e) => e.documentId === docId));
    const other = (await call('POST', '/shipments', { destination: 'CA' }, b.cookie)).body;
    assert.deepEqual((await call('POST', `/shipments/${other.id}/validate?agent=false`, docs, b.cookie)).body.findings, []);
  });
});

describe('other documents and input formats', () => {
  const invoice = [['COMMERCIAL INVOICE'], ['Invoice No.', 'INV-1'], ['Currency', 'USD'], ['Description', 'Qty', 'Unit price', 'Amount'], ['Plush bear', '10', '8.10', '81.00'], ['TOTAL', '10', '', '81.00']];
  const packing = [['PACKING LIST'], ['Packing list no.', 'PL-1'], ['C/No.', 'Cartons', 'Description', 'Qty'], ['1-2', '2', 'Plush bear', '10'], ['TOTAL', '2', '', '10']];
  const upload = async (cookie, shipmentId, name, bytes) => {
    const form = new FormData();
    form.append('files', new Blob([bytes]), name);
    const res = await fetch(`${base}/shipments/${shipmentId}/documents?wait=true`, { method: 'POST', body: form, headers: { cookie } });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  };

  it('keeps spreadsheets, split parts and their cells inside the organization, and closed to viewers', async () => {
    const owner = await signUp('Sheets');
    await call('POST', '/orgs', { name: 'Sheets Co' }, owner.cookie);
    const s = (await call('POST', '/shipments', { destination: 'CA' }, owner.cookie)).body;
    const res = await upload(owner.cookie, s.id, 'folder.xlsx', writeXlsx([{ name: 'Invoice', rows: invoice }, { name: 'Packing list', rows: packing }]));
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const docs = (await call('GET', `/shipments/${s.id}`, undefined, owner.cookie)).body.documents;
    assert.deepEqual(docs.map((d) => [d.detectedType, d.pages]), [['COMMERCIAL_INVOICE', [1]], ['PACKING_LIST', [2]]]);
    const part = docs[1];
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${part.id}/sheets`, undefined, owner.cookie)).status, 200);

    // Another organization's member: everything is 404, as if the shipment did not exist.
    const stranger = await signUp('Stranger sheets');
    for (const [method, path, body] of [
      ['GET', `/shipments/${s.id}/documents/${part.id}/sheets`],
      ['GET', `/shipments/${s.id}/documents/${part.id}/file`],
      ['GET', `/shipments/${s.id}/documents/${part.id}`],
      ['POST', `/shipments/${s.id}/documents/${part.id}/reextract`, { type: 'PACKING_LIST' }],
      ['POST', `/shipments/${s.id}/documents/${part.id}/cancel`],
      ['POST', `/shipments/${s.id}/validate?agent=false`, { airWaybill: undefined }],
    ]) assert.equal((await call(method, path, body, stranger.cookie)).status, 404, `${method} ${path}`);
    assert.equal((await upload(stranger.cookie, s.id, 'packing.csv', writeCsv(packing))).status, 404);

    // A viewer reads the cells but uploads and re-extracts nothing.
    const viewer = await signUp('Viewer sheets');
    await join_(owner, viewer, 'viewer');
    assert.equal((await call('GET', `/shipments/${s.id}/documents/${part.id}/sheets`, undefined, viewer.cookie)).status, 200);
    assert.equal((await upload(viewer.cookie, s.id, 'packing.csv', writeCsv(packing))).status, 403);
    assert.equal((await call('POST', `/shipments/${s.id}/documents/${part.id}/reextract`, { type: 'PACKING_LIST' }, viewer.cookie)).status, 403);
  });
});
