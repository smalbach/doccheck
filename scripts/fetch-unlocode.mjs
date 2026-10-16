// Bundles the UNECE UN/LOCODE code list for rule X13 into packages/rules/src/data/unlocode.json.
//
//   node scripts/fetch-unlocode.mjs                 # download (UNECE first, then its DataHub mirror)
//   node scripts/fetch-unlocode.mjs --csv file.csv  # or build from a CSV already on disk
//
// UNECE publishes the list twice a year as a zip of CSVs (https://unece.org/trade/uncefact/unlocode).
// Its server refuses many automated downloads, so the script falls back to the DataHub copy of the same
// release (https://github.com/datasets/un-locode, code-list.csv). Only what X13 needs is kept: every
// code per country, and which of them have the port function ("1" in the function column).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const OUT = new URL('../packages/rules/src/data/unlocode.json', import.meta.url);
const UNECE = (release) => `https://service.unece.org/trade/locode/loc${release}csv.zip`;
const MIRROR = 'https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv';

const { values } = parseArgs({ options: { csv: { type: 'string' }, release: { type: 'string', default: '242' } } });

/** One CSV line into fields (quotes, doubled quotes inside them). */
function fields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** UNECE CSV: change, country, location, name, name w/o diacritics, subdivision, function, status... DataHub has a header row and the same order up to the name. */
function parse(text, source) {
  const codes = {};
  const ports = {};
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    const f = fields(line);
    const [change, country, location] = f;
    if (!/^[A-Z]{2}$/.test(country ?? '') || !/^[A-Z2-9]{3}$/.test(location ?? '')) continue;
    // "X" marks an entry to be removed in the next release; it is still printed on documents until then.
    void change;
    // The function column is the 8-character one made of digits, dashes and "B".
    const fn = f.find((v) => /^[0-9B-]{8}$/.test(v)) ?? '';
    (codes[country] ??= new Set()).add(location);
    if (fn[0] === '1') (ports[country] ??= new Set()).add(location);
    rows++;
  }
  const pack = (m) => Object.fromEntries(Object.keys(m).sort().map((c) => [c, [...m[c]].sort().join('')]));
  return { source, rows, codes: pack(codes), ports: pack(ports) };
}

async function download() {
  try {
    const res = await fetch(UNECE(values.release), { headers: { 'user-agent': 'doccheck-unlocode/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const dir = mkdtempSync(join(tmpdir(), 'unlocode-'));
    writeFileSync(join(dir, 'loc.zip'), Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-q', '-o', join(dir, 'loc.zip'), '-d', dir]);
    const parts = readdirSync(dir).filter((n) => /CodeListPart\d\.csv$/i.test(n)).sort();
    if (!parts.length) throw new Error('no CodeListPart*.csv in the zip');
    // The UNECE CSVs are Latin-1.
    return { text: parts.map((p) => readFileSync(join(dir, p), 'latin1')).join('\n'), source: `UNECE UN/LOCODE ${values.release}` };
  } catch (err) {
    console.warn(`UNECE download failed (${err.message}); using the DataHub mirror.`);
    const res = await fetch(MIRROR);
    if (!res.ok) throw new Error(`Mirror: HTTP ${res.status}`);
    return { text: await res.text(), source: 'UNECE UN/LOCODE via datasets/un-locode (DataHub)' };
  }
}

const { text, source } = values.csv ? { text: readFileSync(values.csv, 'utf8'), source: `UNECE UN/LOCODE (${values.csv})` } : await download();
const data = parse(text, source);
if (data.rows < 100_000) throw new Error(`Only ${data.rows} codes read; refusing to write a partial list.`);
writeFileSync(OUT, JSON.stringify({ source: data.source, fetched: new Date().toISOString().slice(0, 10), codes: data.codes, ports: data.ports }) + '\n');
console.log(`${data.rows} codes in ${Object.keys(data.codes).length} countries -> ${OUT.pathname}`);
