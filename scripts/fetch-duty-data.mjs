#!/usr/bin/env node
/**
 * Loads the rate tables the duty estimate reads (packages/duties) into data/duties:
 *
 *   us-hts.json.gz     HTSUS rows from the USITC REST export: code, indent, description, units,
 *                      general / special / column 2 rates as printed (parsed by packages/duties).
 *   ca-tariff.json.gz  Canadian Customs Tariff tariff items from the CBSA Access file: MFN and every
 *                      preferential treatment column (UST, MXT, CEUT, CPTPT, COLT, GPT, ...).
 *   fx-ca.json         Bank of Canada daily rates, CAD per unit of foreign currency (Valet API).
 *   fx-us.json         Federal Reserve H.10 noon buying rates in New York, as published (USD per unit
 *                      or units per USD, kept in the published direction so nothing is inverted).
 *
 * Every file carries its source URL, revision or date range and when it was retrieved. The
 * additional-duty tables (Section 301 / 232 / 122, surtaxes), fees, taxes and AD/CVD cases are edited
 * by hand in data/duties because they change by notice, not by a tariff release.
 *
 *   node scripts/fetch-duty-data.mjs --us --ca --fx                 everything (full tariffs, FX this year)
 *   node scripts/fetch-duty-data.mjs --us --headings 8482,6109      only some headings (the committed seed)
 *   node scripts/fetch-duty-data.mjs --ca --ca-file 01-99-2026-2-eng.accdb
 *   node scripts/fetch-duty-data.mjs --fx --from 2026-01-01 --to 2026-10-16
 *
 * Nothing about a shipment is sent anywhere: the script only downloads public tables.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync, inflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    us: { type: 'boolean', default: false },
    ca: { type: 'boolean', default: false },
    fx: { type: 'boolean', default: false },
    headings: { type: 'string' },
    'ca-file': { type: 'string' },
    'ca-url': { type: 'string', default: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/01-99-2026-2-eng.zip' },
    from: { type: 'string' },
    to: { type: 'string' },
    currencies: { type: 'string', default: 'USD,EUR,GBP,CNY,JPY,INR,MXN,KRW,CHF,AUD,BRL,HKD,SGD,TWD,THB,MYR,SEK,NOK,DKK,NZD,ZAR' },
    out: { type: 'string', default: 'data/duties' },
    'no-gzip': { type: 'boolean', default: false },
  },
});
const out = resolve(root, values.out);
const today = new Date().toISOString().slice(0, 10);
const headings = values.headings?.split(',').map((h) => h.replace(/\D/g, '')).filter(Boolean);
const wanted = (code) => !headings || headings.some((h) => code.replace(/\D/g, '').startsWith(h));

if (!values.us && !values.ca && !values.fx) {
  console.error('Pick at least one of --us, --ca, --fx (see the header of this script).');
  process.exit(1);
}
await mkdir(out, { recursive: true });

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'user-agent': 'doccheck-duty-tables (+https://github.com/)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === 'json' ? res.json() : as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

/** Writes a table; the tariffs go gzipped (`--no-gzip` keeps them plain). An empty download never overwrites a table. */
async function save(name, data, gzip = false) {
  if (data.rows && data.rows.length === 0) {
    console.error(`${name}: the source returned no rows; the existing file is kept. Try again later.`);
    process.exitCode = 1;
    return;
  }
  const file = resolve(out, gzip ? `${name}.gz` : name);
  // One row per line: diffs between tariff releases stay readable.
  const { rows, ...meta } = data;
  const body = rows
    ? `{\n  "meta": ${JSON.stringify(meta.meta)},\n  "rows": [\n${rows.map((r) => '    ' + JSON.stringify(r)).join(',\n')}\n  ]\n}\n`
    : JSON.stringify(data, null, 2) + '\n';
  await writeFile(file, gzip ? gzipSync(body, { level: 9 }) : body);
  console.log(`${gzip ? name + '.gz' : name}: ${rows ? rows.length + ' rows' : 'written'}`);
}

if (values.us) {
  const release = (await get('https://hts.usitc.gov/reststop/releaseList')).find((r) => r.status === 'current');
  const chapters = headings ? [...new Set(headings.map((h) => h.slice(0, 2)))] : Array.from({ length: 97 }, (_, i) => String(i + 1).padStart(2, '0'));
  const rows = [];
  for (const ch of chapters) {
    const from = `${ch}01`;
    const to = ch === '99' ? '9999' : `${String(Number(ch) + 1).padStart(2, '0')}00`;
    const list = await get(`https://hts.usitc.gov/reststop/exportList?from=${from}&to=${to}&format=JSON&styles=false`);
    for (const x of list) {
      const code = (x.htsno ?? '').trim();
      if (code && !code.startsWith(ch)) continue;
      // Rows without a number are headings of their group ("Other:"); they belong to the description path.
      if (code ? !wanted(code) : !rows.length || !wanted(rows[rows.length - 1][0] || '')) continue;
      const footnotes = (x.footnotes ?? []).map((f) => f.value?.trim()).filter(Boolean);
      rows.push([code, Number(x.indent ?? 0), clean(x.description), (x.units ?? []).join(','), rate(x.general), rate(x.special), rate(x.other), ...(footnotes.length ? [footnotes.join(' ')] : [])]);
    }
  }
  await save('us-hts.json', {
    meta: {
        table: 'us-hts',
        source: 'USITC Harmonized Tariff Schedule of the United States, REST export',
        url: 'https://hts.usitc.gov/reststop/exportList',
        revision: release?.name ?? 'unknown',
        effectiveDate: release?.releaseStartDate ? toIso(release.releaseStartDate) : today,
        retrievedAt: today,
        scope: headings ? `headings ${headings.join(', ')}` : 'full schedule',
        columns: ['code', 'indent', 'description', 'units', 'general', 'special', 'column2', 'footnotes'],
    },
    rows,
  }, !values['no-gzip']);
}

if (values.ca) {
  let MDBReader;
  try {
    MDBReader = (await import('mdb-reader')).default;
  } catch {
    console.error('Reading the CBSA Access file needs mdb-reader: npm install (it is a devDependency of @doccheck/duties).');
    process.exit(1);
  }
  const buf = values['ca-file'] ? await readFile(resolve(values['ca-file'])) : unzipFirst(await get(values['ca-url'], 'buffer'));
  const db = new MDBReader(buf);
  const table = db.getTable('TPHS');
  const skip = new Set(['TARIFF', 'EFF_DATE', 'CHANGE', 'SUB_CHAP', 'DESC1', 'DESC2', 'DESC3', 'FOOTNOTE', 'UOM', 'row_id']);
  const treatments = table.getColumnNames().filter((c) => !skip.has(c));
  const rows = [];
  for (const r of table.getData()) {
    const code = String(r.TARIFF ?? '').trim();
    if (!code || !wanted(code)) continue;
    const rates = {};
    for (const t of treatments) if (r[t] && String(r[t]).trim()) rates[t === 'General Tariff' ? 'GT' : t] = rate(String(r[t]));
    const desc = [r.DESC1, r.DESC2, r.DESC3].filter(Boolean).map(clean).join(' ');
    const eff = r.EFF_DATE instanceof Date ? r.EFF_DATE.toISOString().slice(0, 10) : '';
    rows.push([code, desc, r.UOM ?? '', eff, rates]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const file = values['ca-file'] ?? values['ca-url'];
  await save('ca-tariff.json', {
    meta: {
      table: 'ca-tariff',
      source: 'CBSA Departmental Consolidation of the Customs Tariff (Access file)',
      url: values['ca-file'] ? 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/menu-eng.html' : values['ca-url'],
      revision: file.split('/').pop().replace(/\.(zip|accdb)$/, ''),
      effectiveDate: rows.reduce((d, r) => (r[3] > d ? r[3] : d), ''),
      retrievedAt: today,
      scope: headings ? `headings ${headings.join(', ')}` : 'full schedule',
      columns: ['code', 'description', 'uom', 'effectiveDate', 'rates by tariff treatment'],
      treatments: treatments.map((t) => (t === 'General Tariff' ? 'GT' : t)),
    },
    rows,
  }, !values['no-gzip']);
}

if (values.fx) {
  const from = values.from ?? `${today.slice(0, 4)}-01-01`;
  const to = values.to ?? today;
  const currencies = values.currencies.split(',').map((c) => c.trim().toUpperCase());

  // Bank of Canada: one series per currency, CAD per unit (FXUSDCAD = CAD per USD).
  const series = currencies.map((c) => `FX${c}CAD`);
  const boc = await get(`https://www.bankofcanada.ca/valet/observations/${series.join(',')}/json?start_date=${from}&end_date=${to}`).catch(async () => {
    // A currency the Bank does not publish fails the whole call: retry one by one.
    const merged = { observations: [] };
    for (const s of series) {
      const one = await get(`https://www.bankofcanada.ca/valet/observations/${s}/json?start_date=${from}&end_date=${to}`).catch(() => undefined);
      for (const o of one?.observations ?? []) {
        const row = merged.observations.find((x) => x.d === o.d) ?? (merged.observations.push({ d: o.d }), merged.observations[merged.observations.length - 1]);
        row[s] = o[s];
      }
    }
    return merged;
  });
  const caRows = [];
  for (const o of boc.observations ?? []) {
    const rates = {};
    for (const c of currencies) if (o[`FX${c}CAD`]?.v) rates[c] = o[`FX${c}CAD`].v;
    if (Object.keys(rates).length) caRows.push([o.d, rates]);
  }
  await save('fx-ca.json', {
    meta: {
      table: 'fx-ca',
      source: 'Bank of Canada daily exchange rates (Valet API)',
      url: 'https://www.bankofcanada.ca/valet/',
      base: 'CAD',
      direction: 'CAD per 1 unit of the foreign currency',
      from,
      to,
      retrievedAt: today,
      columns: ['date', 'rates'],
    },
    rows: caRows,
  });

  // Federal Reserve H.10, all currencies in one CSV. Some series are USD per unit (RXI$US_), most
  // are units per USD (RXI_); the direction is kept per currency.
  const fmtUs = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  // The Board's download page sometimes answers with a page that is not the CSV yet: retry a few times.
  let csv = '';
  for (let attempt = 0; attempt < 4 && !/\n\d{4}-\d{2}-\d{2},/.test(csv); attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt));
    csv = await get(
      `https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&series=60f32914ab61dfab590e0e470153e3ae&lastobs=&from=${fmtUs(from)}&to=${fmtUs(to)}&filetype=csv&label=include&layout=seriescolumn`,
      'text',
    ).catch(() => '');
  }
  const lines = csv.trim().split(/\r?\n/).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
  const codes = lines.find((l) => l[0] === 'Currency:')?.slice(1) ?? [];
  const ids = lines.find((l) => l[0] === 'Time Period')?.slice(1) ?? [];
  const usdPer = ids.map((id) => id.startsWith('RXI$US'));
  const usRows = [];
  for (const l of lines.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x[0]))) {
    const rates = {};
    l.slice(1).forEach((v, i) => {
      if (/^\d+(\.\d+)?$/.test(v)) rates[codes[i]] = usdPer[i] ? { usdPerUnit: v } : { unitsPerUsd: v };
    });
    if (Object.keys(rates).length) usRows.push([l[0], rates]);
  }
  await save('fx-us.json', {
    meta: {
      table: 'fx-us',
      source: 'Federal Reserve statistical release H.10, noon buying rates in New York',
      url: 'https://www.federalreserve.gov/releases/h10/',
      base: 'USD',
      direction: 'as published: usdPerUnit or unitsPerUsd per currency',
      note: '19 CFR 159.34: CBP converts at the rate certified by the Federal Reserve Bank of New York for the date of exportation. Check the certified rate in ACE before filing.',
      from,
      to,
      retrievedAt: today,
      columns: ['date', 'rates'],
    },
    rows: usRows,
  });
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Rates as printed, with the spaces inside program lists dropped: "Free (A+,AU, B)" → "Free (A+,AU,B)". */
function rate(s) {
  return clean(s).replace(/\s*,\s*/g, ',');
}

function toIso(us) {
  const [m, d, y] = us.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** The first file of a zip archive (CBSA ships one .accdb per zip); no dependency needed. */
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Not a zip file');
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (size === 0) {
    // Sizes in the data descriptor: read them from the central directory instead.
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    size = buf.readUInt32LE(cd + 20);
  }
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}
