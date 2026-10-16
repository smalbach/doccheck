#!/usr/bin/env node
/**
 * Accessibility and layout check of the web app with axe-core in a real browser.
 *
 * Signs up a throwaway account, opens a sample, then visits every page in light and dark, at phone
 * (375 px) and desktop (1280 px) widths, and in each language. Reports axe violations (WCAG 2.1 AA),
 * pages wider than the screen, and a missing or wrong <html lang>. Exits 1 on any problem.
 *
 *   npm run build && npm start            # or any running API + web
 *   node scripts/a11y.mjs [--url http://localhost:3000] [--quick]
 *
 * --quick checks English only. With A11Y_ADMIN_EMAIL and A11Y_ADMIN_PASSWORD (an account listed in
 * the server's ADMIN_EMAILS; signed up if it does not exist) the admin pages are checked too.
 * Needs Playwright's Chromium or a local Chrome.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { url: { type: 'string', default: process.env.APP_URL ?? 'http://localhost:3000' }, quick: { type: 'boolean', default: false } } });
const base = values.url.replace(/\/$/, '');
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const problems = [];

async function audit(page, label) {
  await page.waitForLoadState('networkidle');
  // Every page has one heading level 1 once its data is in; without it axe would audit a spinner.
  const rendered = await page.waitForSelector('h1', { timeout: 8000 }).then(() => true, () => false);
  if (!rendered) problems.push(`${label}: no <h1>, the page did not finish rendering`);
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] }),
  );
  for (const v of result.violations) {
    problems.push(`${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${label}: page is ${overflow}px wider than the screen`);
  return result.violations.length;
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));


/** A fresh throwaway account with one sample shipment, so the shipment page has content. Returns that page's path. */
const admin = process.env.A11Y_ADMIN_EMAIL && process.env.A11Y_ADMIN_PASSWORD ? { email: process.env.A11Y_ADMIN_EMAIL, password: process.env.A11Y_ADMIN_PASSWORD } : undefined;

/** A company's and a product's page, once the sample's documents are extracted (none if they are not yet). */
async function entityPages() {
  const first = async (path) => (await (await page.request.get(`${base}${path}?limit=1`)).json()).items?.[0]?.id;
  const [company, product] = await Promise.all([first('/insights/parties'), first('/insights/products')]);
  return [...(company ? [`/app/companies/${company}`] : []), ...(product ? [`/app/products/${product}`] : [])];
}

/** The review screen of the sample's first extracted document (none if it is not extracted within 20 s). */
async function reviewPages(shipmentPath) {
  if (!shipmentPath) return [];
  // The sample is extracted in the background: wait for it (up to 20 s) so every round audits the screen.
  for (let i = 0; i < 40; i++) {
    const shipment = await (await page.request.get(`${base}/shipments/${shipmentPath.split('/').pop()}`)).json();
    const doc = shipment.documents?.find((d) => d.status === 'EXTRACTED');
    if (doc) return [`/app/review/${doc.id}`];
    await page.waitForTimeout(500);
  }
  return [];
}

async function signUpWithSample() {
  await context.clearCookies();
  if (admin) {
    let res = await page.request.post(`${base}/auth/login`, { data: admin });
    if (res.status() === 401) res = await page.request.post(`${base}/auth/register`, { data: { ...admin, name: 'Accessibility admin' } });
    if (!res.ok()) throw new Error(`Admin sign-in failed: ${res.status()} ${await res.text()}`);
  } else {
    const res = await page.request.post(`${base}/auth/register`, {
      data: { email: `a11y-${Date.now()}-${Math.random().toString(36).slice(2)}@doccheck.invalid`, password: `a11y-${Math.random()}`, name: 'Accessibility check' },
    });
    if (!res.ok()) throw new Error(`Sign-up failed: ${res.status()} ${await res.text()}`);
  }
  // Something in each Integrations list, so the lists are audited too (nothing is sent: no test deliveries).
  await Promise.all([
    page.request.post(`${base}/integrations/api-keys`, { data: { name: 'Accessibility', scopes: ['read'] } }),
    page.request.post(`${base}/integrations/webhooks`, { data: { url: 'https://example.com/doccheck', events: ['validation.completed'] } }),
    page.request.post(`${base}/integrations/chat-alerts`, { data: { kind: 'slack', name: '#customs', url: 'https://hooks.slack.com/services/T000/B000/x', events: ['finding.created'] } }),
  ]).catch(() => undefined);
  const samples = await (await page.request.get(`${base}/demo/samples`)).json();
  if (!samples.length) return undefined;
  const shipment = await (await page.request.post(`${base}/demo/samples/${samples[0].id}`)).json();
  return `/app/s/${shipment.id}`;
}

/**
 * A shipment made from a spreadsheet invoice (read without a model), so its page shows a spreadsheet
 * document, and the spreadsheet viewer can be audited. Returns that page's path.
 */
async function spreadsheetShipment() {
  const { writeCsv } = await import('@doccheck/extraction');
  const shipment = await (await page.request.post(`${base}/shipments`, { data: { destination: 'CA', reference: 'Spreadsheet' } })).json();
  const rows = [['COMMERCIAL INVOICE'], ['Invoice No.', 'INV-1'], ['Currency', 'USD'], ['Seller'], ['Acme Toys Co., Ltd.'], ['China'], [], ['Description', 'Qty', 'Unit price', 'Amount'], ['Plush teddy bear', '10', '8.10', '81.00'], ['TOTAL', '10', '', '81.00']];
  const res = await page.request.post(`${base}/shipments/${shipment.id}/documents?wait=true`, { multipart: { files: { name: 'invoice.csv', mimeType: 'text/csv', buffer: Buffer.from(writeCsv(rows)) } } });
  return res.ok() ? `/app/s/${shipment.id}` : undefined;
}

/** Opens the spreadsheet viewer from the document list and audits the page with it open. */
async function auditSheetViewer(label) {
  await page.getByRole('button', { name: 'invoice.csv' }).first().click();
  const shown = await page.waitForSelector('.sheet-grid', { timeout: 8000 }).then(() => true, () => false);
  if (!shown) problems.push(`${label}: the spreadsheet viewer did not open`);
  const n = await audit(page, label);
  await page.keyboard.press('Escape');
  return n;
}

const staticPages = [
  '/app',
  '/app/shipments',
  '/app/shipments/new',
  '/app/inbox',
  '/app/samples',
  '/app/data',
  '/app/goods',
  '/app/companies',
  '/app/products',
  '/app/containers',
  '/app/data/shipments',
  '/app/rules',
  '/app/rules/settings',
  '/app/results',
  '/app/account',
  '/app/team',
  '/app/notifications',
  '/app/approvals',
  '/app/audit',
  '/app/review',
  '/app/usage',
  ...['keys', 'webhooks', 'chat', 'ingestion', 'tracking', 'exports'].map((tab) => `/app/integrations?tab=${tab}`),
  '/app/api-docs',
  ...(admin ? ['/app/admin/settings', '/app/admin/users', '/app/admin/system', '/app/admin/plans'] : []),
];
const locales = values.quick ? ['en'] : ['en', 'es', 'fr'];

for (const locale of locales) {
  for (const theme of ['light', 'dark']) {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      // Reduced motion: toasts that finish during the audit would otherwise be measured mid-animation.
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(([l, t]) => {
        localStorage.setItem('doccheck.locale', l);
        localStorage.setItem('doccheck.theme', t);
      }, [locale, theme]);
      const shipmentPath = await signUpWithSample();
      // A query per round makes the first visit a real page load (a hash change alone is not), so the
      // stored language and theme apply; later hash changes keep that document, like a user would.
      const round = `${locale}-${theme}-${width}`;
      const visit = async (path) => {
        await page.goto(`${base}/?round=${round}#${path}`);
        const lang = await page.evaluate(() => document.documentElement.lang);
        if (lang !== locale) problems.push(`${locale}/${theme}/${width} ${path}: <html lang="${lang}">`);
        const n = await audit(page, `${locale}/${theme}/${width} ${path}`);
        console.log(`${n ? '✗' : '✓'} ${locale} ${theme} ${width}px ${path}${n ? ` (${n})` : ''}`);
      };
      for (const path of [...staticPages, ...(shipmentPath ? [shipmentPath] : []), ...(await entityPages()), ...(await reviewPages(shipmentPath)), '/']) await visit(path);
      const sheetPath = await spreadsheetShipment();
      if (sheetPath) {
        await visit(sheetPath);
        const n = await auditSheetViewer(`${round} ${sheetPath} spreadsheet viewer`);
        console.log(`${n ? '✗' : '✓'} ${locale} ${theme} ${width}px spreadsheet viewer${n ? ` (${n})` : ''}`);
      } else problems.push(`${round}: could not upload a spreadsheet`);
      // The sign-in forms redirect signed-in visitors: check them signed out.
      await context.clearCookies();
      for (const path of ['/', '/login', '/register', '/forgot-password', '/reset-password?token=example', '/invite?token=example']) await visit(path);
    }
  }
}

await browser.close();
const unique = [...new Set(problems)];
if (unique.length) {
  console.log(`\n${unique.length} problem(s):`);
  for (const p of unique) console.log(`  ${p}`);
  process.exit(1);
}
console.log('\nNo accessibility violations or horizontal overflow found.');
