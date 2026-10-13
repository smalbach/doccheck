import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { terminateOcr } from './ocr';
import { readPdfText } from './pdf-text';
import { findSource } from './provenance';
import { SCORED_FIELDS } from './score';

/**
 * Text recall: the share of ground-truth values that appear in the text read from each PDF
 * (text layer or OCR). It measures reading alone, before any model, so OCR settings can be
 * compared quickly. Run on data/eval/v1 for the text-layer baseline.
 *
 *   node dist/ocr-eval-cli.js --data data/eval/v1-scans
 */

const DOCS = [
  { file: 'invoice.pdf', type: 'COMMERCIAL_INVOICE', key: 'invoice' },
  { file: 'packing-list.pdf', type: 'PACKING_LIST', key: 'packingList' },
  { file: 'bill-of-lading.pdf', type: 'BILL_OF_LADING', key: 'billOfLading' },
] as const;

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, part) => {
    if (cur == null) return undefined;
    const m = part.match(/^(\w+)\[(\d+)\]$/);
    return m ? (cur as Record<string, unknown[]>)[m[1]]?.[Number(m[2])] : (cur as Record<string, unknown>)[part];
  }, obj);
}

/** Values as they are printed: skip dates (printed in other formats) and use the printed weight. */
function printedValues(type: (typeof DOCS)[number]['type'], doc: unknown): string[] {
  const out: string[] = [];
  for (const [pattern] of SCORED_FIELDS[type]) {
    if (/Date$/.test(pattern)) continue;
    const path = pattern.replace(/\.kg$/, '.raw.value');
    const arrayPath = path.includes('[*]') ? path.slice(0, path.indexOf('[*]')) : null;
    const n = arrayPath ? ((get(doc, arrayPath) as unknown[]) ?? []).length : 1;
    for (let i = 0; i < n; i++) {
      const v = get(doc, path.replace('[*]', `[${i}]`));
      if (v !== undefined && v !== null && v !== '') out.push(String(v));
    }
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data/eval/v1-scans' }, limit: { type: 'string' } } });
  const dir = resolve(values.data!);
  let ids = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (values.limit) ids = ids.slice(0, Number(values.limit));
  const rows: { id: string; type: string; quality: string; found: number; total: number; ms: number; missing: string[] }[] = [];

  for (const id of ids) {
    const truth = JSON.parse(await readFile(join(dir, id, 'truth.json'), 'utf8'));
    const quality = truth.render.scan ? `${truth.render.scan.dpi} dpi` : 'text layer';
    for (const d of DOCS) {
      const started = Date.now();
      const pdf = await readPdfText(await readFile(join(dir, id, d.file)));
      const want = printedValues(d.type, truth.documents[d.key]);
      const missing = want.filter((v) => !findSource(pdf, d.key, v));
      rows.push({ id, type: d.type, quality, found: want.length - missing.length, total: want.length, ms: Date.now() - started, missing });
    }
  }
  await terminateOcr();

  const pct = (f: number, t: number) => `${t ? ((f / t) * 100).toFixed(1) : '—'}%`;
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { found: number; total: number; docs: number; ms: number }>();
    for (const r of rows) {
      const g = m.get(key(r)) ?? { found: 0, total: 0, docs: 0, ms: 0 };
      g.found += r.found;
      g.total += r.total;
      g.docs++;
      g.ms += r.ms;
      m.set(key(r), g);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  };
  const all = rows.reduce((a, r) => ({ found: a.found + r.found, total: a.total + r.total }), { found: 0, total: 0 });
  console.log(`Text recall on ${basename(dir)}: ${pct(all.found, all.total)} of ${all.total} printed values, ${rows.length} PDFs`);
  for (const [k, g] of group((r) => r.type)) console.log(`  ${k.padEnd(20)} ${pct(g.found, g.total).padStart(7)}  (${g.docs} PDFs)`);
  for (const [k, g] of group((r) => r.quality)) console.log(`  ${k.padEnd(20)} ${pct(g.found, g.total).padStart(7)}  (${g.docs} PDFs, ${Math.round(g.ms / g.docs)} ms each)`);
  const misses = new Map<string, number>();
  rows.flatMap((r) => r.missing).forEach((v) => misses.set(v, (misses.get(v) ?? 0) + 1));
  console.log(`  sample of missed values: ${[...misses.keys()].slice(0, 12).map((v) => JSON.stringify(v)).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
