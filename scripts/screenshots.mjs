#!/usr/bin/env node
/**
 * Screenshots and a short animation of the web app for the README, saved to docs/screenshots/.
 *
 * Signs up a throwaway account, loads a few sample shipments with known errors (CA and US), waits
 * for their documents to be extracted, validates them (rules only, no agent: fast and repeatable),
 * then captures every main page at 1440x900 (device scale 2) in English, light theme; two pages in
 * dark theme; the landing page's hero (hero-light/dark) in a narrower window; one shipment page
 * at phone size (390x844). Finally it records the flow "open a sample -> validate -> open a
 * finding's cited value in the PDF" as an animated WebP, and deletes the account.
 *
 *   npm run build && npm start            # or any running API + web, with the samples in data/eval
 *   node scripts/screenshots.mjs [--url http://localhost:3000] [--out docs/screenshots] [--keep-png] [--inbound-secret <MAIL_INBOUND_SECRET>]
 *
 * It also asks the featured shipment's supplier for corrections (an example.com address: recorded,
 * or sent nowhere real) and marks another finding as an accepted risk; with --inbound-secret (the
 * server's MAIL_INBOUND_SECRET) the supplier's reply with a corrected PDF arrives through the
 * inbound webhook, so the conversation shows both sides.
 *
 * Images are written as WebP (cwebp, from libwebp) and the animation with img2webp; without those
 * tools the PNGs are kept as they are and the animation is skipped. --keep-png also keeps the PNGs.
 * Needs Playwright's Chromium or a local Chrome.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.APP_URL ?? 'http://localhost:3000' },
    out: { type: 'string', default: 'docs/screenshots' },
    'keep-png': { type: 'boolean', default: false },
    'inbound-secret': { type: 'string', default: process.env.MAIL_INBOUND_SECRET ?? '' },
    only: { type: 'string', default: '' },
  },
});
const base = values.url.replace(/\/$/, '');
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'doccheck-shots-'));

const has = (tool) => {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const webp = has('cwebp');
const animate = has('img2webp');

/** Samples to load: errors a reader recognises (weights, packages, container number, currency), both destinations. */
const SAMPLES = ['CA-001', 'CA-014', 'US-007', 'US-046'];
/** The sample opened in the animation, from the samples page (not loaded beforehand). */
const FLOW_SAMPLE = 'US-062';

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Account and data --------------------------------------------------------------------------
const account = { email: `shots-${Date.now()}@doccheck.invalid`, password: `shots-${Math.random().toString(36).slice(2)}-${Date.now()}`, name: 'Alex Rivera' };
const setup = await browser.newContext();
const api = setup.request;
const registered = await api.post(`${base}/auth/register`, { data: account });
if (!registered.ok()) throw new Error(`Sign-up failed: ${registered.status()} ${await registered.text()}`);

async function waitExtracted(id) {
  for (let i = 0; i < 180; i++) {
    const shipment = await (await api.get(`${base}/shipments/${id}`)).json();
    if (shipment.documents?.length && shipment.documents.every((d) => d.status === 'EXTRACTED' || d.status === 'FAILED')) return shipment;
    await sleep(2000);
  }
  throw new Error(`Shipment ${id}: documents not extracted after 6 minutes`);
}

let shipments;
try {
  const available = new Set((await (await api.get(`${base}/demo/samples`)).json()).map((s) => s.id));
  const picked = SAMPLES.filter((id) => available.has(id));
  if (!picked.length) throw new Error('None of the samples is available on this server');
  shipments = [];
  for (const sampleId of picked) {
    const res = await api.post(`${base}/demo/samples/${sampleId}`);
    if (!res.ok()) throw new Error(`Loading ${sampleId} failed: ${res.status()}`);
    shipments.push({ sampleId, id: (await res.json()).id });
  }
  for (const s of shipments) {
    await waitExtracted(s.id);
    const v = await api.post(`${base}/shipments/${s.id}/validate?agent=false`);
    if (!v.ok()) throw new Error(`Validating ${s.sampleId} failed: ${v.status()}`);
    s.findings = (await v.json()).findings.length;
    console.log(`${s.sampleId}: ${s.findings} finding(s)`);
  }
} catch (err) {
  await deleteAccount();
  throw err;
}
// The shipment page shows the one with the most findings.
const featured = [...shipments].sort((a, b) => b.findings - a.findings)[0];

// The finding workflow and the inbox: a request for corrections on all but one finding, that one
// accepted as a risk, and (with the webhook secret) the supplier's answer with a corrected PDF.
let thread;
try {
  const findings = (await (await api.get(`${base}/shipments/${featured.id}/validation`)).json()).findings;
  const [kept, ...asked] = [...findings].reverse();
  if (kept && asked.length) {
    await api.post(`${base}/shipments/${featured.id}/findings/review`, { data: { fingerprints: [kept.fingerprint], status: 'accepted', note: 'Confirmed with the carrier: the booking shows the same container.' } });
    const created = await api.post(`${base}/mail/threads`, {
      data: {
        kind: 'correction_request',
        shipmentId: featured.id,
        to: ['exports@supplier.example.com'],
        cc: [],
        subject: `Corrections needed: shipment Sample ${featured.sampleId}`,
        body: `Hello,\n\nChecking the documents of shipment Sample ${featured.sampleId}, we found the differences listed in this request. Could you send us corrected documents?\n\nThank you,\n${account.name}`,
        language: 'en',
        fingerprints: asked.map((f) => f.fingerprint),
      },
    });
    if (created.ok()) thread = await created.json();
  }
  if (thread && values['inbound-secret']) {
    await sleep(1500); // the outbox sends the request first
    const nodemailer = createRequire(resolve('apps/api/package.json'))('nodemailer');
    const pdf = ['data/demo', 'data/eval/v1'].map((d) => join(d, featured.sampleId, 'bill-of-lading.pdf')).find((f) => { try { readFileSync(f); return true; } catch { return false; } });
    const reply = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: 'Mei Chen <exports@supplier.example.com>',
      to: thread.replyTo,
      subject: `Re: ${thread.subject}`,
      text: `Hi ${account.name.split(' ')[0]},\n\nSorry for the mix-up. The corrected bill of lading is attached; the packing list is right.\n\nBest regards,\nMei Chen\nExport desk`,
      attachments: pdf ? [{ filename: 'bill-of-lading-corrected.pdf', content: readFileSync(pdf), contentType: 'application/pdf' }] : [],
    });
    const res = await fetch(`${base}/mail/inbound`, { method: 'POST', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': values['inbound-secret'] }, body: reply.message });
    if (!res.ok) console.warn(`The supplier's reply was not accepted: ${res.status}`);
  }
} catch (err) {
  console.warn(`Inbox shots will be incomplete: ${err instanceof Error ? err.message : err}`);
}
const cookies = (await setup.storageState()).cookies;

async function deleteAccount() {
  const res = await api.delete(`${base}/auth/me`, { data: { password: account.password } });
  console.log(res.ok() ? 'Throwaway account deleted.' : `Could not delete the throwaway account ${account.email}: ${res.status()}`);
}

// --- Capture ------------------------------------------------------------------------------------
const written = [];

async function newPage({ theme = 'light', width = 1440, height = 900, signedIn = true, scale = 2 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, locale: 'en-US' });
  if (signedIn) await context.addCookies(cookies);
  await context.addInitScript((t) => {
    localStorage.setItem('doccheck.locale', 'en');
    localStorage.setItem('doccheck.theme', t);
  }, theme);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.warn(`page error: ${err.message}`));
  return page;
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  // Notes about a development server without SMTP are not part of the product's look.
  await page.addStyleTag({ content: '.mail-dev-note { display: none !important; }' });
  await page.waitForSelector('h1', { timeout: 10000 });
  // Fonts, charts and transitions.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

async function save(page, name) {
  const png = join(work, `${name}.png`);
  await page.screenshot({ path: png });
  let file = png;
  if (webp) {
    file = join(out, `${name}.webp`);
    execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', '-sharp_yuv', png, '-o', file]);
    if (values['keep-png']) await rename(png, join(out, `${name}.png`));
  } else {
    file = join(out, `${name}.png`);
    await rename(png, file);
  }
  const { size } = await stat(file);
  written.push(`${file.replace(`${process.cwd()}/`, '')} ${(size / 1024).toFixed(0)} KB`);
  console.log(`✓ ${name}`);
}

/** --only hero-light,hero-dark: capture just those (the setup still runs). */
const only = new Set(values.only.split(',').filter(Boolean));

async function shoot(page, path, name, before) {
  if (only.size && !only.has(name)) return;
  await page.goto(`${base}/?shot=${name}#${path}`);
  await settle(page);
  if (before) await before(page);
  await save(page, name);
}

const openCitedValue = async (page) => {
  await page.locator('.finding .evidence-link').first().click();
  await page.waitForSelector('.pdf-page canvas');
  await page.waitForTimeout(1200);
};

try {
  // Signed out.
  const guest = await newPage({ signedIn: false });
  await shoot(guest, '/', 'landing');
  await guest.context().close();

  // The landing page's hero: the same shipment in a narrower window (1152x720 at 2.5x, still 2880x1800),
  // so the interface reads at the size the landing shows it instead of a shrunken 1440 layout.
  for (const theme of ['light', 'dark']) {
    const page = await newPage({ theme, width: 1152, height: 720, scale: 2.5 });
    await shoot(page, `/app/s/${featured.id}`, `hero-${theme}`);
    await page.context().close();
  }

  for (const theme of ['light', 'dark']) {
    const page = await newPage({ theme });
    await shoot(page, '/app', `dashboard-${theme}`);
    await shoot(page, `/app/s/${featured.id}`, `shipment-findings-${theme}`);
    if (theme === 'light') {
      await shoot(page, '/app/shipments', 'shipments');
      await shoot(page, `/app/s/${featured.id}`, 'shipment-pdf-viewer', openCitedValue);
      await shoot(page, '/app/data', 'extracted-data-summary');
      await shoot(page, '/app/goods', 'extracted-data-goods');
      await shoot(page, '/app/companies', 'companies');
      await shoot(page, '/app/products', 'products');
      // The company and the product with the most purchases, for their own pages.
      const first = async (path) => (await (await page.request.get(`${base}${path}?limit=1`)).json()).items?.[0]?.id;
      const company = await first('/insights/parties');
      const product = await first('/insights/products');
      if (company) await shoot(page, `/app/companies/${company}`, 'company');
      if (product) await shoot(page, `/app/products/${product}`, 'product-prices');
      await shoot(page, '/app/containers', 'containers');
      if (thread) {
        await shoot(page, '/app/inbox?filter=all', 'inbox');
        await shoot(page, `/app/inbox/${thread.id}`, 'conversation');
      }
      await shoot(page, `/app/s/${featured.id}`, 'request-compose', async (p) => {
        await p.getByRole('button', { name: 'Ask for corrections' }).click();
        await p.waitForSelector('.dialog textarea');
        await p.locator('.dialog input[inputmode="email"]').first().fill('exports@supplier.example.com');
        await p.waitForTimeout(400);
      });
      await shoot(page, `/app/s/${featured.id}`, 'shipment-duties', async (p) => {
        const duties = p.locator('.duties').first();
        if (await duties.count()) {
          await duties.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 80));
          await p.waitForTimeout(400);
        }
      });
      await shoot(page, '/app/review', 'review-queue');
      await shoot(page, '/app/analytics', 'analytics-kpis');
      await shoot(page, '/app/analytics/suppliers', 'analytics-suppliers');
      await shoot(page, '/app/analytics/cost', 'analytics-cost');
      await shoot(page, '/app/analytics/regulations', 'analytics-regulations');
      await shoot(page, '/app/screening', 'screening');
      await shoot(page, '/app/integrations', 'integrations');
      await shoot(page, '/app/api-docs', 'api-docs');
      await shoot(page, '/app/rules', 'rules');
      await shoot(page, '/app/results', 'evaluation-results');
      await shoot(page, '/app/samples', 'samples');
    }
    await page.context().close();
  }

  const phone = await newPage({ width: 390, height: 844, scale: 3 });
  // On a phone the findings come below the documents: show the first ones.
  await shoot(phone, `/app/s/${featured.id}`, 'mobile-shipment', async (p) => {
    await p.locator('.finding').first().evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 140));
    await p.waitForTimeout(300);
  });
  await phone.context().close();

  if (animate && !only.size) await recordFlow();
  else console.log('img2webp not found: animation skipped.');
} finally {
  await deleteAccount();
  await browser.close();
  await rm(work, { recursive: true, force: true });
}

console.log(`\n${written.join('\n')}`);

// --- Animation ----------------------------------------------------------------------------------
/**
 * Screenshots taken back to back while the flow runs, each shown for as long as it was on screen,
 * joined into an animated WebP. A drawn pointer shows where the clicks go.
 */
async function recordFlow() {
  const page = await newPage({ width: 1280, height: 800, scale: 1 });
  await page.goto(`${base}/?shot=flow#/app/samples`);
  await settle(page);
  await page.addStyleTag({
    content: `#shot-pointer{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(37,99,235,.35);border:2px solid rgba(37,99,235,.9);pointer-events:none;transition:transform .15s}
      #shot-pointer.down{transform:scale(.7)}`,
  });
  await page.evaluate(() => {
    const p = document.createElement('div');
    p.id = 'shot-pointer';
    p.style.left = '640px';
    p.style.top = '400px';
    document.documentElement.append(p);
  });

  const frames = [];
  let recording = true;
  const loop = (async () => {
    while (recording) {
      const path = join(work, `frame-${String(frames.length).padStart(4, '0')}.png`);
      await page.screenshot({ path, animations: 'allow' }).catch(() => undefined);
      frames.push({ path, at: Date.now() });
    }
  })();

  let pointer = { x: 640, y: 400 };
  const pointTo = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const x = pointer.x + (target.x - pointer.x) * e;
      const y = pointer.y + (target.y - pointer.y) * e;
      await page.evaluate(([px, py]) => Object.assign(document.getElementById('shot-pointer').style, { left: `${px}px`, top: `${py}px` }), [x, y]);
      await page.mouse.move(x, y);
      await sleep(30);
    }
    pointer = target;
    await sleep(300);
  };
  const clickOn = async (locator) => {
    await pointTo(locator);
    await page.evaluate(() => document.getElementById('shot-pointer').classList.add('down'));
    await sleep(150);
    await locator.click();
    await page.evaluate(() => document.getElementById('shot-pointer').classList.remove('down'));
  };

  await sleep(800);
  const filter = page.locator('input.sample-search');
  if (await filter.count()) {
    await clickOn(filter);
    await filter.pressSequentially(FLOW_SAMPLE, { delay: 90 });
    await sleep(600);
  }
  await clickOn(page.locator('button.sample', { hasText: FLOW_SAMPLE }).first());
  await page.waitForURL(/#\/app\/s\//, { timeout: 30000 });
  // Extraction of the three PDFs (cached answers on a prepared server: a few seconds).
  const validate = page.getByRole('button', { name: 'Validate', exact: true });
  await validate.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Validate' && !b.disabled), undefined, { timeout: 360000 });
  await sleep(600);
  const agent = page.getByRole('checkbox', { name: /Agent review/ });
  if ((await agent.count()) && (await agent.isChecked())) await clickOn(agent);
  await clickOn(validate);
  const evidence = page.locator('.finding .evidence-link').first();
  await evidence.waitFor({ timeout: 60000 });
  await sleep(1500);
  await clickOn(evidence);
  await page.waitForSelector('.pdf-page canvas');
  await sleep(2600);
  recording = false;
  await loop;
  await page.context().close();

  // Each frame lasts until the next one; the last holds for two seconds. A frame identical in time
  // to the previous one (a screenshot that came back instantly) is folded into it.
  const args = ['-loop', '0', '-lossless', '-q', '60', '-m', '4'];
  for (let i = 0; i < frames.length; i++) {
    const duration = i + 1 < frames.length ? frames[i + 1].at - frames[i].at : 2000;
    if (duration < 20) continue;
    args.push('-d', String(Math.min(duration, 3000)), frames[i].path);
  }
  const file = join(out, 'flow.webp');
  execFileSync('img2webp', [...args, '-o', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  const { size } = await stat(file);
  written.push(`${file.replace(`${process.cwd()}/`, '')} ${(size / 1024).toFixed(0)} KB (${frames.length} frames)`);
  console.log(`✓ flow (${frames.length} frames)`);
}
