// End-to-end tests of the AI provider settings (/admin/ai) against a real Postgres, on their own
// database and port so they run next to e2e.test.mjs. The model, embedding and OCR services are
// fakes served by this file on 127.0.0.1; no real AI service is called.
//
//   npm run build && npm run test:e2e -w @doccheck/api
//
// Uses DATABASE_URL_AI_TEST, else the database of DATABASE_URL_TEST (or doccheck_test) with _test
// replaced by _ai_test, on port E2E_PORT + 5 (+1 orgs, +2 usage and review, +3 integrations,
// +4 analytics, +7 portal, +9 the demo server of e2e.test.mjs).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
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
  if (process.env.DATABASE_URL_AI_TEST) return process.env.DATABASE_URL_AI_TEST;
  const u = new URL(process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
  const name = process.env.DATABASE_URL_TEST ? u.pathname.slice(1) : 'doccheck_test';
  if (!name.endsWith('_test')) throw new Error(`Refusing to derive a database from "${name}": the test database name must end in _test`);
  u.pathname = `/${name.replace(/_test$/, '_ai_test')}`;
  return u.toString();
})();
const dbName = new URL(testUrl).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the test database name must end in _test`);

const port = Number(process.env.E2E_AI_PORT ?? Number(process.env.E2E_PORT ?? 3990) + 5);
const base = `http://localhost:${port}`;

/** Every request the fake services received. */
const seen = [];
/** Keys the fake services accept; anything else gets a 401 that echoes the key back. */
const KEYS = { openai: 'sk-test-openai-123', anthropic: 'ant-test-key-456', gemini: 'gem-test-key-789', vision: 'vision-test-key-000' };

const fakes = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    seen.push({ url: req.url, headers: req.headers, body });
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const deny = (given) => send(401, { error: { message: `Incorrect API key provided: ${given}` } });
    if (req.url === '/v1/chat/completions') {
      if (req.headers.authorization !== `Bearer ${KEYS.openai}`) return deny(req.headers.authorization);
      return send(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    }
    if (req.url === '/v1/embeddings') {
      if (req.headers.authorization !== `Bearer ${KEYS.openai}`) return deny(req.headers.authorization);
      return send(200, { data: body.input.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3, 0.4] })) });
    }
    if (req.url === '/v1/messages') {
      if (req.headers['x-api-key'] !== KEYS.anthropic) return deny(req.headers['x-api-key']);
      return send(200, { content: [{ type: 'tool_use', name: 'answer', input: { ok: true } }], usage: { input_tokens: 5, output_tokens: 3 } });
    }
    if (req.url?.startsWith('/v1beta/models/') && req.url.endsWith(':batchEmbedContents')) {
      if (req.headers['x-goog-api-key'] !== KEYS.gemini) return deny(req.headers['x-goog-api-key']);
      return send(200, { embeddings: body.requests.map(() => ({ values: [1, 0, 0] })) });
    }
    if (req.url === '/v1/images:annotate') {
      if (req.headers['x-goog-api-key'] !== KEYS.vision) return deny(req.headers['x-goog-api-key']);
      const word = (text, x) => ({ symbols: [...text].map((c) => ({ text: c })), confidence: 0.95, boundingBox: { vertices: [{ x, y: 100 }, { x: x + 100, y: 100 }, { x: x + 100, y: 160 }, { x, y: 160 }] } });
      return send(200, { responses: [{ fullTextAnnotation: { pages: [{ blocks: [{ paragraphs: [{ words: [word('DocCheck', 60), word('12345', 900)] }] }] }] } }] });
    }
    send(404, { error: `no fake for ${req.url}` });
  });
});

// A small corpus for the index rebuild: two documents copied from data/corpus.
const corpusDir = mkdtempSync(join(tmpdir(), 'doccheck-ai-corpus-'));
cpSync(join(root, 'data/corpus/cbsa/cbsa-d1-4-1-en.md'), join(corpusDir, 'cbsa/cbsa-d1-4-1-en.md'), { recursive: true });
cpSync(join(root, 'data/corpus/cbp/cfr-19-149.md'), join(corpusDir, 'cbp/cfr-19-149.md'), { recursive: true });

let api;
let pool;
let fakeUrl;

const sessionCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='))?.split(';')[0] ?? '';
const call = async (method, path, body, as) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(as ? { cookie: as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text, cookie: sessionCookie(res) };
};
const signUp = async (email = `${randomUUID()}@example.com`) => {
  const res = await call('POST', '/auth/register', { email, password: 'correct horse battery', name: 'AI' });
  assert.equal(res.status, 201);
  return res.cookie;
};

let admin;
let user;

before(async () => {
  await new Promise((r) => fakes.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fakes.address().port}`;
  const adminDb = new URL(testUrl);
  adminDb.pathname = '/postgres';
  const c = new pg.Client({ connectionString: adminDb.toString() });
  await c.connect();
  if ((await c.query('select 1 from pg_database where datname = $1', [dbName])).rowCount === 0) await c.query(`create database ${dbName}`);
  await c.end();
  pool = new pg.Pool({ connectionString: testUrl });
  await pool.query('drop schema public cascade; create schema public');
  const env = { ...process.env };
  // The suite starts from a plain local setup whatever .env says.
  for (const k of Object.keys(env)) if (/^(AI_LOCAL_ONLY|LLM_PROVIDER|LLM_REMOTE_MODEL|EMBED_|OPENAI_|AZURE_|ANTHROPIC_|GEMINI_|GOOGLE_VISION_|TEXTRACT_|OCR_ENGINE)/.test(k)) delete env[k];
  api = spawn('node', [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: {
      ...env,
      PORT: String(port),
      DATABASE_URL: testUrl,
      REDIS_URL: '',
      S3_ENDPOINT: '',
      STORAGE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-ai-')),
      ADMIN_EMAILS: 'admin-ai@example.com',
      LLM_CACHE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-ai-cache-')),
      LLM_CACHE_MODE: 'replay',
      AGENT_ENABLED: 'false',
      SMTP_URL: '',
      IMAP_URL: '',
      RETENTION_JOB: 'off',
      MAIL_CAPTURE_DIR: mkdtempSync(join(tmpdir(), 'doccheck-ai-mail-')),
      SETTINGS_KEY_FILE: join(mkdtempSync(join(tmpdir(), 'doccheck-ai-key-')), 'settings.key'),
      // Anthropic, Gemini and Vision at the fakes (a local address, so "local only" lets them through).
      CORPUS_DIR: corpusDir,
      ANTHROPIC_BASE_URL: fakeUrl,
      GEMINI_BASE_URL: fakeUrl,
      GOOGLE_VISION_URL: fakeUrl,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  admin = await signUp('admin-ai@example.com');
  user = await signUp();
});

after(async () => {
  api?.kill();
  fakes.close();
  await pool?.end();
});

const emptyCredentials = { openai: null, azureOpenai: null, anthropic: null, gemini: null, googleVision: null, awsTextract: null, azureDi: null };
const config = (over = {}) => ({
  localOnly: true,
  llm: { provider: 'ollama', model: null },
  embeddings: { provider: 'ollama', model: null, dimensions: null },
  ...over,
  credentials: { ...emptyCredentials, ...(over.credentials ?? {}) },
});

describe('AI provider settings', () => {
  it('are for admins, and start local only with Ollama', async () => {
    assert.equal((await call('GET', '/admin/ai', undefined, user)).status, 403);
    const view = (await call('GET', '/admin/ai', undefined, admin)).body;
    assert.equal(view.source, 'env');
    assert.equal(view.editable, true);
    assert.equal(view.config.localOnly, true);
    assert.match(view.active.llm, /^ollama:/);
    assert.equal(view.active.embeddings, 'ollama:bge-m3');
  });

  it('refuses an outside service while local only is on', async () => {
    const res = await call('PUT', '/admin/ai', config({ llm: { provider: 'openai', model: 'gpt-x' }, credentials: { openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' } } }), admin);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /local only/);
    const gemini = await call('PUT', '/admin/ai', config({ embeddings: { provider: 'gemini', model: 'gemini-embedding-001', dimensions: null }, credentials: { gemini: { apiKey: 'k' } } }), admin);
    assert.equal(gemini.status, 200, 'Gemini at a local fake is allowed');
    // Back to a plain local setup for the next tests.
    assert.equal((await call('PUT', '/admin/ai', config(), admin)).status, 200);
  });

  it('uses a self-hosted OpenAI-compatible server with local only on, keeping its key sealed', async () => {
    const res = await call('PUT', '/admin/ai', config({ llm: { provider: 'openai', model: 'local-llama' }, credentials: { openai: { baseUrl: `${fakeUrl}/v1`, apiKey: KEYS.openai } } }), admin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.source, 'admin');
    assert.equal(res.body.active.llm, 'openai:local-llama');
    assert.equal(res.body.config.credentials.openai.hasKey, true);
    assert.ok(!res.text.includes(KEYS.openai), 'the key is never sent back');
    const { rows } = await pool.query("select value::text as v from settings where key = 'aiProviders'");
    assert.ok(!rows[0].v.includes(KEYS.openai), 'the key is stored sealed');
    assert.match(rows[0].v, /"secret": ?\{"iv":/);

    const test = await call('POST', '/admin/ai/test', { target: 'llm' }, admin);
    assert.equal(test.status, 200);
    assert.equal(test.body.ok, true, test.body.detail);
    assert.match(test.body.detail, /openai:local-llama answered/);
    assert.equal(seen.at(-1).body.model, 'local-llama');
    assert.equal(seen.at(-1).body.response_format.type, 'json_schema');
  });

  it('keeps a saved key when the form leaves it empty, and tests unsaved values', async () => {
    const res = await call('PUT', '/admin/ai', config({ llm: { provider: 'openai', model: 'local-llama' }, embeddings: { provider: 'openai', model: 'nomic-embed', dimensions: null }, credentials: { openai: { baseUrl: `${fakeUrl}/v1` } } }), admin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.active.embeddings, 'openai:nomic-embed');
    assert.equal(res.body.indexes.regulations, false, 'no index built with this embedder yet');
    const emb = await call('POST', '/admin/ai/test', { target: 'embeddings' }, admin);
    assert.equal(emb.body.ok, true, emb.body.detail);
    assert.match(emb.body.detail, /4 dimensions/);

    // Rebuild the regulation index with this embedder (the tariff index is left alone: its data is the repository's).
    const started = await call('POST', '/admin/ai/reindex', { scope: 'regulations' }, admin);
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.embedder, 'openai:nomic-embed');
    assert.equal((await call('POST', '/admin/ai/reindex', { scope: 'regulations' }, admin)).status, 409, 'one rebuild at a time');
    let view;
    for (let i = 0; i < 100; i++) {
      view = (await call('GET', '/admin/ai', undefined, admin)).body;
      if (!view.reindex.running) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(view.reindex.error, undefined);
    assert.equal(view.indexes.regulations, true);
    assert.ok(existsSync(join(corpusDir, 'index', 'openai-nomic-embed.json')));

    // A wrong key in unsaved values: the error comes back without the key.
    const bad = await call('POST', '/admin/ai/test', { target: 'llm', config: config({ llm: { provider: 'openai', model: 'm' }, credentials: { openai: { baseUrl: `${fakeUrl}/v1`, apiKey: 'sk-wrong-secret-999' } } }) }, admin);
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.detail, /401/);
    assert.ok(!bad.text.includes('sk-wrong-secret-999'), bad.body.detail);
  });

  it('uses Anthropic and Gemini once outside services are allowed', async () => {
    const res = await call(
      'PUT',
      '/admin/ai',
      config({ localOnly: false, llm: { provider: 'anthropic', model: 'claude-test' }, embeddings: { provider: 'gemini', model: 'gemini-embedding-001', dimensions: 768 }, credentials: { anthropic: { apiKey: KEYS.anthropic }, gemini: { apiKey: KEYS.gemini } } }),
      admin,
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.active.llm, 'anthropic:claude-test');
    assert.equal(res.body.active.embeddings, 'gemini:gemini-embedding-001@768');
    assert.equal(res.body.config.credentials.openai, null, 'a section left out is removed');
    assert.equal((await call('POST', '/admin/ai/test', { target: 'llm' }, admin)).body.ok, true);
    const emb = await call('POST', '/admin/ai/test', { target: 'embeddings' }, admin);
    assert.equal(emb.body.ok, true, emb.body.detail);
    assert.equal(seen.at(-1).body.requests[0].outputDimensionality, 768);
    // The system page reports what is in use.
    const system = (await call('GET', '/admin/system', undefined, admin)).body;
    assert.equal(system.model.provider, 'anthropic:claude-test');
    assert.equal(system.localOnly, false);
  });

  it('runs a cloud OCR engine only with its key, and tests it on a printed image', async () => {
    const without = await call('PUT', '/admin/settings', { ocrEngine: 'google-vision' }, admin);
    assert.equal(without.status, 400);
    assert.match(without.body.message, /GOOGLE_VISION_API_KEY/);
    const current = (await call('GET', '/admin/ai', undefined, admin)).body.config;
    const saved = await call('PUT', '/admin/ai', { ...current, credentials: { ...emptyCredentials, anthropic: {}, gemini: {}, googleVision: { apiKey: KEYS.vision } } }, admin);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.config.credentials.anthropic.hasKey, true, 'an empty key keeps the saved one');
    assert.equal((await call('PUT', '/admin/settings', { ocrEngine: 'google-vision' }, admin)).status, 200);
    const settings = (await call('GET', '/admin/settings', undefined, admin)).body;
    assert.ok(settings.options.ocrEngines.includes('azure-di'));
    const test = await call('POST', '/admin/ai/test', { target: 'google-vision' }, admin);
    assert.equal(test.body.ok, true, test.body.detail);
    assert.match(test.body.detail, /DocCheck 12345/);
    assert.ok(seen.at(-1).body.requests[0].image.content.length > 100, 'a PNG was sent');

    // The Vision key cannot be removed while the engine uses it.
    const drop = await call('PUT', '/admin/ai', { ...current, credentials: { ...emptyCredentials, anthropic: {}, gemini: {} } }, admin);
    assert.equal(drop.status, 400);
    assert.match(drop.body.message, /OCR/);
    assert.equal((await call('DELETE', '/admin/ai', undefined, admin)).status, 400, 'nor reset to .env');
    assert.equal((await call('DELETE', '/admin/settings/ocrEngine', undefined, admin)).status, 200);
  });

  it('resets to .env', async () => {
    const res = await call('DELETE', '/admin/ai', undefined, admin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.source, 'env');
    assert.match(res.body.active.llm, /^ollama:/);
    assert.equal(res.body.config.localOnly, true);
    assert.equal((await pool.query("select 1 from settings where key = 'aiProviders'")).rowCount, 0);
  });

  it('validates the form', async () => {
    assert.equal((await call('PUT', '/admin/ai', config({ credentials: { openai: { baseUrl: 'http://user:pw@host/v1' } } }), admin)).status, 400);
    assert.equal((await call('PUT', '/admin/ai', config({ llm: { provider: 'other', model: null } }), admin)).status, 400);
    assert.equal((await call('PUT', '/admin/ai', config({ llm: { provider: 'anthropic', model: null } }), admin)).status, 400);
    assert.equal((await call('POST', '/admin/ai/test', { target: 'nothing' }, admin)).status, 400);
  });
});
