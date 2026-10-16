// End-to-end tests of the supplier portal (docs/PORTAL.md) against the built API and a real Postgres,
// like e2e.test.mjs but on a database and port of their own, so both files can run at once.
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Uses the test database name (DATABASE_URL_TEST, else doccheck_test) with "_portal" before "_test",
// and port E2E_PORT + 7.
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
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

const baseUrl = (() => {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const u = new URL(process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  u.pathname = '/doccheck_test';
  return u.toString();
})();
const baseName = new URL(baseUrl).pathname.slice(1);
if (!baseName.endsWith('_test')) throw new Error(`Refusing to reset "${baseName}": the test database name must end in _test`);
const dbName = baseName.replace(/_test$/, '_portal_test');
const testUrl = (() => {
  const u = new URL(baseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

const port = Number(process.env.E2E_PORT ?? 3990) + 7;
const base = `http://localhost:${port}`;
const mailDir = mkdtempSync(join(tmpdir(), 'doccheck-portal-mail-'));
const apiRequire = createRequire(join(root, 'apps/api/package.json'));
const { simpleParser } = apiRequire('mailparser');
let api;
let pool;
let repo;

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
const send = (url, init = {}, as = '') => fetch(url, { ...init, headers: { ...init.headers, ...(as ? { cookie: as } : {}) } });
const call = async (method, path, body, as) => {
  const res = await send(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, as);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
};
const signUp = async (name) => (await account(name)).cookie;
/** A new account: { cookie, email }. */
const account = async (name) => {
  const email = `${randomUUID()}@example.com`;
  const res = await send(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse battery', name }) });
  assert.equal(res.status, 201);
  return { cookie: sessionCookie(res), email };
};
/** Invites `who` into the active organization of `by` with `role`, and accepts. */
const joinOrg = async (by, who, role) => {
  assert.equal((await call('POST', '/orgs/current/invites', { email: who.email, role }, by)).status, 201);
  const mail = await until(() =>
    readdirSync(mailDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(mailDir, f), 'utf8')))
      .find((m) => m.to === who.email),
  );
  const token = /token=([\w-]+)/.exec(mail.text)[1];
  assert.equal((await call('POST', '/orgs/invites/accept', { token }, who.cookie)).status, 200);
};
/** The audit rows about a portal request, oldest first. */
const auditOf = (requestId) => pool.query(`select action, org_id, user_id, user_email, ip from audit_log where entity = 'portal_request' and entity_id = $1 order by id`, [requestId]).then((r) => r.rows);

/** The supplier's calls: the token in X-Portal-Token, no cookie. */
const portal = (token, path = '/portal/session', init = {}) =>
  fetch(base + path, { ...init, headers: { ...init.headers, ...(token === undefined ? {} : { 'x-portal-token': token }) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => undefined), headers: r.headers }));
const upload = (token, files, note) => {
  const form = new FormData();
  for (const [name, bytes] of files) form.append('files', new Blob([bytes], { type: 'application/pdf' }), name);
  if (note) form.append('note', note);
  return portal(token, '/portal/uploads', { method: 'POST', body: form });
};

const until = async (check, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timed out');
};

/** The text part of the captured email whose subject has `text`, once the outbox sent it. */
const sentText = async (text) => {
  const eml = await until(() => readdirSync(mailDir).filter((f) => f.endsWith('.eml')).map((f) => readFileSync(join(mailDir, f))).find((m) => m.toString('utf8').includes(text)));
  return (await simpleParser(eml)).text;
};
const tokenIn = (text) => /#\/portal\?t=([0-9a-f]{32}\.[\w-]+)/.exec(text)?.[1];

/** Puts extracted documents in a shipment, as the extraction worker would. */
async function addExtracted(shipmentId, docs) {
  for (const [type, data] of Object.entries(docs)) {
    const id = randomUUID();
    await repo.insertDocument({ id, shipmentId, fileName: `${type}.pdf`, storageKey: 'none', sha256: '0', status: 'EXTRACTING' });
    await repo.saveExtraction(id, { pageCount: 1, detectedType: type, typeConfidence: 1 }, { documentId: id, documentType: type, model: 'test', promptVersion: 'test', raw: {}, data, issues: [], pdfLines: [] });
  }
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
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-portal-')),
      LLM_CACHE_DIR: join(root, 'eval/cache/ollama_qwen3.8'),
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
      SMTP_URL: '',
      MAIL_CAPTURE_DIR: mailDir,
      MAIL_FROM: 'DocCheck <docs@doccheck.example>',
      MAIL_OUTBOX_MS: '200',
      PORTAL_CHECK_MS: '300',
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-portal-key-')), 'settings.key'),
      IMAP_URL: '',
      APP_URL: 'http://app.example/',
      RETENTION_JOB: 'off',
      ADMIN_EMAILS: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const require = createRequire(import.meta.url);
  require('reflect-metadata');
  const { ShipmentsRepository } = require(join(root, 'apps/api/dist/shipments/shipments.repository.js'));
  pool = new pg.Pool({ connectionString: testUrl });
  repo = new ShipmentsRepository(pool);
});

after(async () => {
  api?.kill();
  await pool?.end();
});

describe('supplier portal', () => {
  let importer;
  let shipment;
  let thread;
  let token;
  let requestId;
  let fp;

  it('puts a link in a correction request only when it is sent, and keeps only its hash', async () => {
    importer = await signUp('Importer Co');
    shipment = (await call('POST', '/shipments', { destination: 'CA', reference: 'PORTAL-1' }, importer)).body;
    await addExtracted(shipment.id, { COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: samplePackingList, BILL_OF_LADING: { ...sampleBillOfLading, totalPackages: 121 } });
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, importer);
    const run = (await call('GET', `/shipments/${shipment.id}/validation`, undefined, importer)).body;
    fp = run.findings.find((f) => f.ruleId === 'X2')?.fingerprint ?? run.findings[0].fingerprint;

    const created = await call(
      'POST',
      '/mail/threads',
      { kind: 'correction_request', shipmentId: shipment.id, to: ['supplier@example.com'], subject: 'Corrections needed: PORTAL-1', body: 'Please fix the package count.\n\nUpload here: {{portal-link}}', language: 'es', fingerprints: [fp], portal: true },
      importer,
    );
    assert.equal(created.status, 201);
    thread = created.body;
    // Stored with the placeholder: the database never holds a working link.
    assert.match(thread.items[0].text, /Upload here: \{\{portal-link\}\}/);

    const text = await sentText('Corrections needed: PORTAL-1');
    token = tokenIn(text);
    assert.ok(token, 'the email carries the link');
    assert.match(text, /Upload here: http:\/\/app\.example\/#\/portal\?t=/);
    const { rows } = await pool.query('select l.token_hash, r.id from portal_links l join portal_requests r on r.id = l.request_id where r.thread_id = $1', [thread.id]);
    assert.equal(rows.length, 1);
    requestId = rows[0].id;
    assert.deepEqual(rows[0].token_hash, createHash('sha256').update(token).digest());
    const leaks = await pool.query(`select count(*)::int as n from mail_messages where text_body like '%' || $1 || '%'`, [token.split('.')[1]]);
    assert.equal(leaks.rows[0].n, 0);

    // The importer copies the same link from the app.
    const copied = (await call('GET', `/supplier-portal/requests/${requestId}/link`, undefined, importer)).body;
    assert.equal(copied.url, `http://app.example/#/portal?t=${token}`);
    assert.equal((await call('GET', `/supplier-portal/requests/${requestId}/link`, undefined, await signUp('Stranger'))).status, 404);
  });

  it('shows the supplier the findings asked about, without internal data, and nothing else', async () => {
    const session = await portal(token);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const v = session.body;
    assert.deepEqual([v.kind, v.status, v.language, v.importer, v.reference], ['correction', 'waiting', 'es', 'Importer Co', 'PORTAL-1']);
    assert.deepEqual(v.findings.map((f) => [f.fingerprint, f.state]), [[fp, 'open']]);
    const json = JSON.stringify(v);
    for (const secret of ['documentId', 'agentRationale', 'suggestedFix', 'shipmentId', 'userId', shipment.id]) assert.ok(!json.includes(secret), `no ${secret}`);
    assert.ok(v.findings[0].evidence.every((e) => e.documentType && e.field && 'value' in e));

    // Without a token, with a forged or altered one, or with the importer's session: nothing.
    assert.equal((await portal(undefined)).status, 404);
    assert.equal((await portal('')).status, 404);
    assert.equal((await portal(`${token.split('.')[0]}.${'A'.repeat(43)}`)).status, 404);
    assert.equal((await portal(`${randomUUID().replace(/-/g, '')}.${token.split('.')[1]}`)).status, 404);
    assert.equal((await fetch(`${base}/portal/session`, { headers: { cookie: importer } })).status, 404);
    // The token opens no other route.
    for (const path of [`/shipments/${shipment.id}`, `/mail/threads/${thread.id}`, `/supplier-portal/requests/${requestId}`]) {
      assert.equal((await fetch(base + path, { headers: { 'x-portal-token': token } })).status, 401, path);
    }
  });

  it('takes PDFs only, files them in the conversation and the shipment, and checks them', async () => {
    const refused = await upload(token, [['notes.pdf', Buffer.from('MZ not a pdf')]]);
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /notes\.pdf is not a PDF/);

    const ok = await upload(token, [['bl-corrected.pdf', Buffer.from('%PDF-1.4\n%fake\n')]], 'Corregido, gracias.');
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.uploads.map((u) => [u.status, u.files]), [['extracting', ['bl-corrected.pdf']]]);

    // In the conversation as a received message with the file attached and in the shipment.
    const t = (await call('GET', `/mail/threads/${thread.id}`, undefined, importer)).body;
    const msg = t.items.at(-1);
    assert.deepEqual([t.status, t.unread, msg.direction, msg.viaPortal, msg.text, msg.from], ['replied', 1, 'in', true, 'Corregido, gracias.', `${sampleInvoice.seller.name} (portal) <supplier@example.com>`]);
    assert.equal(msg.attachments[0].filename, 'bl-corrected.pdf');
    const docs = (await call('GET', `/shipments/${shipment.id}`, undefined, importer)).body.documents;
    assert.ok(docs.some((d) => d.id === msg.attachments[0].documentId));

    // Once extracted (this fake PDF fails), the shipment is validated again.
    const checked = await until(async () => {
      const s = (await portal(token)).body;
      return s.uploads[0].status === 'validated' && s;
    });
    assert.equal(checked.status, 'open');

    // The B/L corrected (as the extraction of a real PDF would give it): the finding shows as fixed.
    await addExtracted(shipment.id, { BILL_OF_LADING: sampleBillOfLading });
    await call('POST', `/shipments/${shipment.id}/validate?agent=false`, undefined, importer);
    const fixed = (await portal(token)).body;
    assert.deepEqual([fixed.status, fixed.findings.map((f) => [f.fingerprint, f.state])], ['clean', [[fp, 'fixed']]]);

    const detail = (await call('GET', `/supplier-portal/requests/${requestId}`, undefined, importer)).body;
    assert.equal(detail.status, 'clean');
    const kinds = new Set(detail.events.map((e) => e.kind));
    for (const k of ['link_created', 'opened', 'uploaded', 'upload_refused', 'checked']) assert.ok(kinds.has(k), k);
    assert.deepEqual(detail.events.find((e) => e.kind === 'uploaded').files, ['bl-corrected.pdf']);
  });

  it('stops a link that is replaced, revoked, expired or whose request is closed', async () => {
    const fresh = (await call('POST', `/supplier-portal/requests/${requestId}/links`, { days: 7 }, importer)).body;
    const next = tokenIn(fresh.path);
    assert.notEqual(next, token);
    assert.deepEqual([(await portal(token)).status, (await portal(token)).body.reason], [410, 'revoked']);
    assert.equal((await portal(next)).status, 200);

    await pool.query(`update portal_links set expires_at = now() - interval '1 second' where request_id = $1 and revoked_at is null`, [requestId]);
    assert.deepEqual([(await portal(next)).status, (await portal(next)).body.reason], [410, 'expired']);
    assert.equal((await call('GET', `/supplier-portal/requests/${requestId}/link`, undefined, importer)).status, 404);

    const again = tokenIn((await call('POST', `/supplier-portal/requests/${requestId}/links`, {}, importer)).body.path);
    assert.equal((await call('POST', `/supplier-portal/requests/${requestId}/close`, { closed: true }, importer)).body.status, 'closed');
    assert.deepEqual([(await portal(again)).status, (await portal(again)).body.reason], [410, 'closed']);
    await call('POST', `/supplier-portal/requests/${requestId}/close`, { closed: false }, importer);
    assert.equal((await portal(again)).status, 200);

    const revoked = (await call('POST', `/supplier-portal/requests/${requestId}/revoke`, {}, importer)).body;
    assert.ok(revoked.links.every((l) => !l.active));
    assert.equal((await portal(again)).status, 410);
    assert.equal((await upload(again, [['x.pdf', Buffer.from('%PDF-1.4')]])).status, 410);
    const denied = (await call('GET', `/supplier-portal/requests/${requestId}`, undefined, importer)).body.events.filter((e) => e.kind === 'denied').map((e) => e.reason);
    assert.ok(['revoked', 'expired', 'closed'].every((r) => denied.includes(r)));
    // Another user's requests are not theirs to manage.
    const other = await signUp('Not theirs');
    for (const [method, path] of [['GET', `/supplier-portal/requests/${requestId}`], ['POST', `/supplier-portal/requests/${requestId}/links`], ['POST', `/supplier-portal/requests/${requestId}/revoke`]]) {
      assert.equal((await call(method, path, method === 'POST' ? {} : undefined, other)).status, 404);
    }
  });

  it('checks a supplier\'s draft documents before shipping, skipping the rules that need the B/L', async () => {
    const partyId = thread.partyId;
    const created = await call(
      'POST',
      '/supplier-portal/requests',
      { partyId, reference: 'PO-77', destination: 'CA', language: 'en', to: ['supplier@example.com'], subject: 'Pre-shipment check: PO-77', body: 'Please upload your drafts.' },
      importer,
    );
    assert.equal(created.status, 201);
    const req = created.body;
    assert.deepEqual([req.kind, req.status, req.reference, req.supplier], ['pre_shipment', 'waiting', 'PO-77', sampleInvoice.seller.name]);
    const text = await sentText('Pre-shipment check: PO-77');
    assert.match(text, /Upload the draft invoice and packing list here/);
    const pre = tokenIn(text);

    const before = (await portal(pre)).body;
    assert.deepEqual([before.kind, before.status, before.findings, before.skipped], ['pre_shipment', 'waiting', [], []]);
    // Their earlier request shows by status only.
    assert.deepEqual(before.history.map((h) => [h.kind, h.status, h.current]), [['pre_shipment', 'waiting', true], ['correction', 'clean', false]]);
    assert.ok(before.history.every((h) => Object.keys(h).sort().join() === ['createdAt', 'current', 'kind', 'reference', 'status'].sort().join()));

    // The drafts: an invoice and a packing list that disagree on the package count.
    await addExtracted(req.shipmentId, { COMMERCIAL_INVOICE: sampleInvoice, PACKING_LIST: { ...samplePackingList, totalPackages: 999 } });
    assert.equal((await upload(pre, [['draft.pdf', Buffer.from('%PDF-1.4\n%draft\n')]])).status, 201);
    const after = await until(async () => {
      const s = (await portal(pre)).body;
      return s.uploads[0]?.status === 'validated' && s;
    });
    assert.ok(after.skipped.length > 0);
    assert.ok(after.skipped.every((s) => s.missing.length > 0));
    assert.ok(after.skipped.some((s) => s.missing.includes('BILL_OF_LADING')));
    assert.equal(after.status, after.findings.length ? 'open' : 'clean');

    // The importer sees each supplier's status.
    const list = (await call('GET', `/supplier-portal/requests?kind=pre_shipment&partyId=${partyId}`, undefined, importer)).body;
    assert.deepEqual(list.items.map((r) => [r.reference, r.status]), [['PO-77', after.status]]);
  });

  it('keeps requests in their organization, records supplier activity in the audit log as the supplier', async () => {
    const orgId = (await call('GET', '/orgs', undefined, importer)).body.active.id;
    const { rows: [row] } = await pool.query('select r.org_id, s.org_id as shipment_org, t.org_id as thread_org from portal_requests r join shipments s on s.id = r.shipment_id join mail_threads t on t.id = r.thread_id where r.id = $1', [requestId]);
    assert.deepEqual([row.org_id, row.shipment_org, row.thread_org], [orgId, orgId, orgId]);
    // Portal uploads landed in the shipment's organization.
    const { rows: docs } = await pool.query('select distinct d.shipment_id, s.org_id from portal_uploads u join documents d on d.id = any(u.document_ids) join shipments s on s.id = d.shipment_id where u.request_id = $1', [requestId]);
    assert.deepEqual(docs.map((d) => d.org_id), [orgId]);

    const rows = await auditOf(requestId);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['portal.create', 'portal.open', 'portal.upload', 'portal.upload_refused', 'portal.denied', 'portal.link_create', 'portal.link_revoke', 'portal.close', 'portal.reopen']) assert.ok(actions.has(a), a);
    assert.ok(rows.every((r) => r.org_id === orgId));
    for (const r of rows.filter((r) => ['portal.open', 'portal.upload', 'portal.upload_refused', 'portal.denied'].includes(r.action))) {
      assert.equal(r.user_id, null, r.action);
      assert.match(r.user_email, /^supplier:.*\(portal link [0-9a-f]{8}\)$/, r.action);
    }
    assert.ok(rows.filter((r) => r.action === 'portal.link_create').every((r) => r.user_id));
    // A member of the importer's organization signed in on the same browser does not change whose activity it is.
    const member = await account('Signed-in member');
    const good = tokenIn((await call('POST', `/supplier-portal/requests/${requestId}/links`, {}, importer)).body.path);
    assert.equal((await fetch(`${base}/portal/session`, { headers: { 'x-portal-token': good, cookie: member.cookie } })).status, 200);
  });

  it('answers 404 to another organization and lets only owners, admins and analysts make links', async () => {
    const stranger = await signUp('Other organization');
    const routes = [
      ['GET', `/supplier-portal/requests/${requestId}`],
      ['GET', `/supplier-portal/requests/${requestId}/link`],
      ['POST', `/supplier-portal/requests/${requestId}/links`, {}],
      ['POST', `/supplier-portal/requests/${requestId}/revoke`, {}],
      ['POST', `/supplier-portal/requests/${requestId}/close`, { closed: true }],
      ['POST', `/supplier-portal/threads/${thread.id}/request`, {}],
    ];
    for (const [method, path, body] of routes) assert.equal((await call(method, path, body, stranger)).status, 404, `${method} ${path}`);
    assert.equal((await call('GET', '/supplier-portal/requests', undefined, stranger)).body.total, 0);
    // A pre-shipment check cannot name another organization's company or shipment.
    const pre = { partyId: thread.partyId, reference: 'X', destination: 'CA', language: 'en', to: ['s@example.com'], subject: 's', body: 'b' };
    assert.equal((await call('POST', '/supplier-portal/requests', pre, stranger)).status, 404);

    // Members of the importer's organization, by role.
    const [viewer, client, analyst] = [await account('Viewer'), await account('Client'), await account('Analyst')];
    await joinOrg(importer, viewer, 'viewer');
    await joinOrg(importer, client, 'client');
    await joinOrg(importer, analyst, 'analyst');
    for (const who of [viewer, client]) {
      for (const [method, path, body] of routes.slice(1)) assert.equal((await call(method, path, body, who.cookie)).status, 403, `${method} ${path}`);
      assert.equal((await call('POST', '/supplier-portal/requests', pre, who.cookie)).status, 403);
    }
    // A viewer reads where requests stand; a client sees nothing of them.
    assert.equal((await call('GET', `/supplier-portal/requests/${requestId}`, undefined, viewer.cookie)).status, 200);
    assert.equal((await call('GET', '/supplier-portal/requests', undefined, client.cookie)).status, 403);
    // An analyst works the team's requests, made by someone else.
    const made = await call('POST', `/supplier-portal/requests/${requestId}/links`, {}, analyst.cookie);
    assert.equal(made.status, 201);
    assert.equal((await portal(tokenIn(made.body.path))).status, 200);
    const madeByAnalyst = (await auditOf(requestId)).filter((r) => r.action === 'portal.link_create').at(-1);
    assert.ok(madeByAnalyst.user_id);
  });

  it('throttles an address that keeps trying links that do not work', async () => {
    const good = tokenIn((await call('POST', `/supplier-portal/requests/${requestId}/links`, {}, importer)).body.path);
    let refused = 0;
    for (let i = 0; i < 30 && refused === 0; i++) if ((await portal(`${randomUUID().replace(/-/g, '')}.x`)).status === 429) refused++;
    assert.equal(refused, 1);
    const blocked = await portal(good);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
});
