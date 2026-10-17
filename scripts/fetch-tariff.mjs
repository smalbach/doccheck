// Downloads the two tariff schedules and their section and chapter notes, and normalizes them to
//   data/tariff/us/schedule.json   HTSUS, from the USITC export (JSON)
//   data/tariff/ca/schedule.json   Customs Tariff, from the CBSA Access database (.accdb in a zip)
//   data/tariff/<us|ca>/notes.json section and chapter notes, read from each chapter PDF
// Sources are public government files. Run again to refresh (both change several times a year).
//
//   node scripts/fetch-tariff.mjs [--only us|ca] [--cache .data/tariff-download]
//
// A schedule entry is [code, description, parent]: `code` holds digits only ("9503000090", or "" for a
// US grouping row without a number), `parent` is the index of the entry it sits under (-1 at the top).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import MDBReader from 'mdb-reader';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const { values } = parseArgs({ options: { only: { type: 'string' }, cache: { type: 'string', default: '.data/tariff-download' } } });
const OUT = 'data/tariff';
const UA = 'DocCheck-tariff/0.1 (portfolio project; https://github.com/)';
const retrievedAt = new Date().toISOString().slice(0, 10);

const US = {
  release: 'https://hts.usitc.gov/reststop/releaseList',
  export: 'https://hts.usitc.gov/reststop/exportList?from=0100&to=9999&format=JSON&styles=false',
  chapter: (n) => `https://hts.usitc.gov/reststop/file?release=currentRelease&filename=${encodeURIComponent(`Chapter ${n}`)}`,
  page: 'https://hts.usitc.gov/',
};
// The latest consolidated schedule on https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/menu-eng.html.
const CA = {
  edition: 'Customs Tariff 2026, consolidated to September 1, 2026',
  zip: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/01-99-2026-2-eng.zip',
  chapter: (n) => `https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/01-99/ch${String(n).padStart(2, '0')}-2026-2-eng.pdf`,
  page: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/menu-eng.html',
  // Section notes are not in the chapter PDFs; this page has all of them.
  sections: 'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/section-eng.html',
};
/** First and last chapter of each HS section. */
const SECTIONS = { I: [1, 5], II: [6, 14], III: [15, 15], IV: [16, 24], V: [25, 27], VI: [28, 38], VII: [39, 40], VIII: [41, 43], IX: [44, 46], X: [47, 49], XI: [50, 63], XII: [64, 67], XIII: [68, 70], XIV: [71, 71], XV: [72, 83], XVI: [84, 85], XVII: [86, 89], XVIII: [90, 92], XIX: [93, 93], XX: [94, 96], XXI: [97, 97] };
const sectionOf = (chapter) => Object.entries(SECTIONS).find(([, [a, b]]) => chapter >= a && chapter <= b)?.[0] ?? null;
/** HS chapters with legal notes (77 is reserved; 98 and 99 are national provisions). */
const CHAPTERS = Array.from({ length: 97 }, (_, i) => i + 1).filter((n) => n !== 77);

async function get(url, cacheName) {
  const cached = cacheName && join(values.cache, cacheName);
  if (cached && existsSync(cached)) return readFile(cached);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA } }).catch((err) => ({ ok: false, status: err.message }));
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (cached) {
        await mkdir(values.cache, { recursive: true });
        await writeFile(cached, bytes);
      }
      return bytes;
    }
    if (attempt >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

/** Runs `fn` over `items` with at most `n` at a time, keeping the order of the results. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const clean = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ---- Schedules ----

async function usSchedule() {
  const releases = JSON.parse((await get(US.release)).toString('utf8'));
  const current = releases.find((r) => r.status === 'current') ?? releases[0];
  const rows = JSON.parse((await get(US.export, `htsus-${current.name}.json`)).toString('utf8'));
  // Indent gives the tree: a row sits under the closest row above it with a smaller indent.
  const entries = [];
  const stack = [];
  for (const row of rows) {
    const indent = Number(row.indent);
    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.index ?? -1;
    entries.push([String(row.htsno ?? '').replace(/\D/g, ''), clean(row.description), parent]);
    stack.push({ indent, index: entries.length - 1 });
  }
  return { schedule: 'US', title: 'Harmonized Tariff Schedule of the United States', edition: current.description, effectiveDate: toIso(current.releaseStartDate), url: US.page, retrievedAt, entries };
}

const toIso = (mdy) => (mdy ? mdy.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2') : undefined);

async function caSchedule() {
  const zip = await get(CA.zip, 'ca-customs-tariff.zip');
  await mkdir(values.cache, { recursive: true });
  const zipFile = join(values.cache, 'ca-customs-tariff.zip');
  if (!existsSync(zipFile)) await writeFile(zipFile, zip);
  // One .accdb file in the archive; `unzip -p` streams it without writing anything else.
  const name = execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8' }).split('\n').find((f) => f.endsWith('.accdb'));
  const db = new MDBReader(execFileSync('unzip', ['-p', zipFile, name], { maxBuffer: 256 * 1024 * 1024 }));
  const rows = db.getTable('TPHS').getData({ columns: ['TARIFF', 'DESC1', 'DESC2', 'DESC3'] });
  // Rows have no indent: a row sits under the longest code that prefixes it (grouping rows have odd lengths).
  const byCode = new Map();
  for (const r of rows) {
    const code = String(r.TARIFF).replace(/\D/g, '');
    if (!code || byCode.has(code)) continue;
    byCode.set(code, [r.DESC1, r.DESC2, r.DESC3].map(clean).filter(Boolean).join(' '));
  }
  const codes = [...byCode.keys()].sort((a, b) => (a.padEnd(10, ' ') < b.padEnd(10, ' ') ? -1 : 1));
  const index = new Map();
  const entries = [];
  for (const code of codes) {
    let parent = -1;
    for (let len = code.length - 1; len >= 4; len--) {
      if (index.has(code.slice(0, len))) {
        parent = index.get(code.slice(0, len));
        break;
      }
    }
    index.set(code, entries.length);
    entries.push([code, byCode.get(code), parent]);
  }
  return { schedule: 'CA', title: 'Customs Tariff (Canada), Schedule', edition: CA.edition, effectiveDate: '2026-09-01', url: CA.page, retrievedAt, entries };
}

// ---- Notes ----

/** Text lines of each page, in reading order (items on the same baseline joined by x). */
async function pdfPages(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const lines = new Map();
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      (lines.get(key) ?? lines.set(key, []).get(key)).push({ x: it.transform[4], s: it.str });
    }
    const text = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim());
    // The notes come before the tariff table, which can start halfway down a page.
    const header = text.findIndex(isTableHeader);
    pages.push(header < 0 ? text : text.slice(0, header));
    if (header >= 0) break;
  }
  await task.destroy();
  return pages;
}

/** First line of the tariff table header: "Heading/ Stat. Unit ..." (USITC) or "Tariff Unit of MFN ..." (CBSA). */
const isTableHeader = (line) => /^Heading\/?(\s|$)/.test(line) || /^Tariff(\s+(Item|Unit|SS)\b|$)/.test(line);

const NOISE = [
  /^CUSTOMS TARIFF - SCHEDULE$/i,
  /^\d{1,2} - [ivx]+$/i,
  /^(Issued|Revised) [A-Z][a-z]+ \d{1,2}, \d{4}$/,
  /^Harmonized Tariff Schedule of the United States/i,
  /^Annotated for Statistical Reporting Purposes$/i,
  /^[IVX]+-\d+$/,
  /^\d{1,2} ?- ?\d+$/,
  /^\d{1,2}-[ivx]+$/i,
  /^[ivx]+$/i,
];
const KIND = [
  [/^Additional U\.? ?S\.? Subheading Notes?\.?$/i, 'additional'],
  [/^Additional U\.? ?S\.? Notes?\.?$/i, 'additional'],
  [/^Statistical (Head)?Notes?\.?$/i, 'statistical'],
  [/^Subheading Notes?\.?$/i, 'subheading'],
  [/^Supplementary Notes?\.?$/i, 'supplementary'],
  [/^Notes?\.?$/i, 'legal'],
];

/**
 * Splits the text before the tariff table into section notes (only in the first chapter of a
 * section) and chapter notes, each numbered note on its own.
 */
function parseNotes(pages, chapter) {
  // A page label can share the baseline of a title line: "TOYS, GAMES ... THEREOF 95-1".
  const lines = pages.flat().map((l) => l.replace(/\s+(\d{1,2}|[IVX]+)-(\d+|[ivx]+)$/, '')).filter((l) => l && !NOISE.some((re) => re.test(l)));
  const out = { section: null, chapter: { title: '', notes: [] } };
  let target = null;
  let titleOf = null;
  let kind = 'legal';
  let note = null;
  for (const line of lines) {
    const sec = line.match(/^SECTION ([IVXL]+)\b\s*(.*)$/i);
    const chap = line.match(/^CHAPTER (\d{1,2})\b\s*(.*)$/i);
    if (sec && !target?.notes.length && !out.chapter.notes.length && out.section === null) {
      out.section = { number: sec[1].toUpperCase(), title: sec[2], notes: [] };
      target = out.section;
      titleOf = target;
      kind = 'legal';
      note = null;
      continue;
    }
    if (chap && Number(chap[1]) === chapter && out.chapter.notes.length === 0) {
      target = out.chapter;
      target.title = chap[2];
      titleOf = target;
      kind = 'legal';
      note = null;
      continue;
    }
    if (!target) continue;
    const k = KIND.find(([re]) => re.test(line));
    if (k) {
      kind = k[1];
      titleOf = null;
      note = null;
      continue;
    }
    if (titleOf) {
      titleOf.title = `${titleOf.title} ${line}`.trim();
      continue;
    }
    const n = line.match(/^(\d{1,2})\.\s+(.*)$/);
    if (n) {
      note = { kind, number: n[1], text: n[2] };
      target.notes.push(note);
      continue;
    }
    if (!note) {
      // Text between a heading and the first numbered note (e.g. a single unnumbered note).
      note = { kind, number: '', text: line };
      target.notes.push(note);
      continue;
    }
    // Lettered items start on their own line; anything else continues the sentence.
    note.text += /^\([a-z]{1,2}\)|^\((i|ii|iii|iv|v|vi)\)/.test(line) ? `\n${line}` : ` ${line}`;
  }
  const tidy = (s) => s.replace(/(\w)- (\w)/g, '$1-$2').replace(/ +/g, ' ').trim();
  for (const part of [out.section, out.chapter].filter(Boolean)) {
    part.title = tidy(part.title).replace(/\s+([;,])/g, '$1');
    part.notes = part.notes.map((n) => ({ ...n, text: tidy(n.text) })).filter((n) => n.text.length > 0);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** CBSA section notes: one <details> per section, notes as nested lists, read as lines by parseNotes. */
async function caSections() {
  const html = (await get(CA.sections, 'ca-sections.html')).toString('utf8');
  const sections = {};
  for (const block of html.split(/<details\b/).slice(1)) {
    const h = block.match(/<h2[^>]*id="_s\d+"[^>]*>([\s\S]*?)<\/h2>/);
    const m = h && decode(h[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().match(/^Section ([IVXL]+):\s*(.*)$/i);
    if (!m) continue;
    const body = block.slice(block.indexOf('</summary>'), block.indexOf('</details>'));
    const lines = decode(body.replace(/<(li|h3|h4|p)\b[^>]*>/gi, '\n').replace(/<\/h[34]>/gi, '\n').replace(/<[^>]+>/g, ' '))
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l && !/^\[Section .* PDF/i.test(l));
    const parsed = parseNotes([[`SECTION ${m[1]}`, ...lines]], 0);
    sections[m[1].toUpperCase()] = { title: m[2].toUpperCase(), url: `${CA.sections}#_s${Object.keys(SECTIONS).indexOf(m[1].toUpperCase()) + 1}`, notes: parsed.section?.notes ?? [] };
  }
  return sections;
}

async function notes(country) {
  const src = country === 'us' ? US : CA;
  const parsed = await pool(CHAPTERS, 4, async (n) => {
    const url = src.chapter(n);
    try {
      return { n, url, ...parseNotes(await pdfPages(await get(url, `${country}-ch${String(n).padStart(2, '0')}.pdf`)), n) };
    } catch (err) {
      console.warn(`  ${country} chapter ${n}: ${err.message}`);
      return null;
    }
  });
  const sections = country === 'ca' ? await caSections() : {};
  const chapters = {};
  for (const p of parsed.filter(Boolean)) {
    if (p.section) sections[p.section.number] = { title: p.section.title, url: p.url, notes: p.section.notes };
    chapters[String(p.n).padStart(2, '0')] = { title: p.chapter.title, section: sectionOf(p.n), url: p.url, notes: p.chapter.notes };
  }
  return { schedule: country.toUpperCase(), retrievedAt, sections, chapters };
}

async function save(country, name, data) {
  const dir = join(OUT, country);
  await mkdir(dir, { recursive: true });
  // One entry per line: readable diffs between editions, and still plain JSON.
  const json = JSON.stringify(data, null, 1).replace(/\[\n\s+("[^"]*"),\n\s+("(?:[^"\\]|\\.)*"),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2, $3]');
  await writeFile(join(dir, name), json + '\n');
}

for (const country of ['us', 'ca'].filter((c) => !values.only || values.only === c)) {
  console.log(`${country.toUpperCase()}: schedule`);
  const schedule = country === 'us' ? await usSchedule() : await caSchedule();
  await save(country, 'schedule.json', schedule);
  console.log(`  ${schedule.entries.length} entries, ${schedule.edition}`);
  console.log(`${country.toUpperCase()}: notes from ${CHAPTERS.length} chapter PDFs`);
  const n = await notes(country);
  await save(country, 'notes.json', n);
  const count = Object.values(n.chapters).reduce((a, c) => a + c.notes.length, 0) + Object.values(n.sections).reduce((a, s) => a + s.notes.length, 0);
  console.log(`  ${Object.keys(n.sections).length} sections, ${Object.keys(n.chapters).length} chapters, ${count} notes`);
}
