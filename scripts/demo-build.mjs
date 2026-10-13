#!/usr/bin/env node
/**
 * Builds data/demo, the curated samples of the read-only demo (DEMO_READONLY=true).
 *
 * Picks a few shipments from data/eval/v1 (one per error kind and destination, plus clean ones),
 * runs each through a running API in normal mode, with the local model available, so every answer
 * the demo needs lands in the caches:
 *   eval/cache/<model>/                    extraction and agent answers
 *   data/corpus/index/<embed>.queries.json citation query vectors
 * then copies their PDFs, truth and labels to data/demo and deletes the warm-up shipments.
 *
 *   npm start                       # API on :3000, LLM_CACHE_DIR=eval/cache/ollama_qwen3.8
 *   node scripts/demo-build.mjs [--api http://localhost:3000] [--per-kind 1] [--clean 2]
 *
 * The API needs a session: the script signs in as DEMO_BUILD_EMAIL / DEMO_BUILD_PASSWORD when set,
 * otherwise it signs up a throwaway account (its shipments are deleted at the end either way).
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.API_URL ?? 'http://localhost:3000' },
    from: { type: 'string', default: 'data/eval/v1' },
    out: { type: 'string', default: 'data/demo' },
    'per-kind': { type: 'string', default: '1' },
    clean: { type: 'string', default: '2' },
  },
});
const api = values.api.replace(/\/$/, '');
let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  const session = res.headers.getSetCookie().find((c) => c.startsWith('doccheck_session='));
  if (session) cookie = session.split(';')[0];
  return res.status === 204 ? null : res.json();
}

// Password of the account this run signs up, so it can delete it at the end.
let throwaway;
const health = await call('GET', '/health');
if (process.env.DEMO_BUILD_EMAIL && process.env.DEMO_BUILD_PASSWORD) {
  await call('POST', '/auth/login', { email: process.env.DEMO_BUILD_EMAIL, password: process.env.DEMO_BUILD_PASSWORD });
} else {
  const email = `demo-build-${randomBytes(6).toString('hex')}@doccheck.invalid`;
  throwaway = randomBytes(18).toString('base64url');
  await call('POST', '/auth/register', { email, password: throwaway, name: 'demo-build' });
  console.log(`Signed up ${email} for this run (deleted at the end)`);
}
if (health.demo) throw new Error('The API runs in demo mode; start it in normal mode with the local model to warm the caches.');

// One shipment per error kind and destination (the first that has it), plus clean ones.
const manifest = JSON.parse(await readFile(join(values.from, 'manifest.json'), 'utf8'));
const chosen = [];
for (const destination of ['CA', 'US']) {
  const rows = manifest.shipments.filter((s) => s.destination === destination);
  chosen.push(...rows.filter((s) => s.errors.length === 0).slice(0, Number(values.clean)));
  const kinds = [...new Set(rows.flatMap((s) => s.errors))].sort();
  for (const kind of kinds) {
    for (const s of rows.filter((r) => r.errors.includes(kind) && !chosen.includes(r)).slice(0, Number(values['per-kind']))) chosen.push(s);
  }
}
chosen.sort((a, b) => a.id.localeCompare(b.id));
console.log(`Warming ${chosen.length} samples: ${chosen.map((s) => s.id).join(', ')}`);

const ok = [];
for (const s of chosen) {
  const started = Date.now();
  const shipment = await call('POST', `/demo/samples/${s.id}`);
  let current;
  for (;;) {
    current = await call('GET', `/shipments/${shipment.id}`);
    if (!current.documents.some((d) => d.status === 'QUEUED' || d.status === 'EXTRACTING')) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const failed = current.documents.filter((d) => d.status !== 'EXTRACTED');
  const validation = failed.length ? null : await call('POST', `/shipments/${shipment.id}/validate`);
  await call('DELETE', `/shipments/${shipment.id}`);
  const agent = validation?.agent;
  if (failed.length || agent?.status !== 'done') {
    console.log(`  ${s.id} skipped: ${failed.length ? failed.map((d) => `${d.fileName} ${d.status} ${d.error ?? ''}`).join('; ') : `agent ${agent?.status} ${agent?.error ?? ''}`}`);
    continue;
  }
  console.log(`  ${s.id} ok: ${validation.findings.length} findings, ${agent.citations} citations, ${agent.decisions.length} agent decisions (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  ok.push(s);
}

// Replace the previous samples; other files in the folder (README.md) stay.
await mkdir(values.out, { recursive: true });
for (const entry of await readdir(values.out)) if (/^(CA|US)-\d{3}$/.test(entry) || entry === 'manifest.json') await rm(join(values.out, entry), { recursive: true, force: true });
for (const s of ok) {
  await mkdir(join(values.out, s.id), { recursive: true });
  for (const f of ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf', 'truth.json', 'labels.json']) await cp(join(values.from, s.id, f), join(values.out, s.id, f));
}
await writeFile(join(values.out, 'manifest.json'), JSON.stringify({ ...manifest, source: values.from, shipments: ok }, null, 2) + '\n');
console.log(`Wrote ${ok.length} samples to ${values.out}. Commit it with eval/cache and data/corpus/index/*.queries.json.`);
if (throwaway) {
  await call('DELETE', '/auth/me', { password: throwaway });
  console.log('Deleted the throwaway account.');
}
