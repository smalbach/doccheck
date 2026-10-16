import type { BillOfLading, CommercialInvoice, PackingList } from '@doccheck/schemas';
import { fieldPointer } from '@doccheck/schemas';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { extractDocument, type ExtractableType } from './extract';
import { LlmClient, llmFromEnv } from './llm';
import { terminateOcr } from './ocr';
import { scoreDocument, tally, type FieldScore } from './score';
import { DEFAULT_SUPPLIER_EXAMPLES, detectSupplier, exampleFromCorrection, supplierKey, type SupplierExample } from './supplier-examples';

/**
 * Measures supplier learning (supplier-examples.ts) the way it is used: shipments come in one after
 * another; a reviewer corrects every value the extraction got wrong (from the ground truth), each
 * correction becomes an example for that supplier, and the supplier's next documents are extracted
 * with its latest examples in the prompt. Each document is also extracted without examples (the
 * baseline, as `npm run eval:extraction` does), and both are scored field by field.
 *
 *   node dist/supplier-eval-cli.js --data data/eval/v1 --limit 60
 *   node dist/supplier-eval-cli.js --data data/eval/supplier-quirk     # scripts/supplier-quirk-set.mjs
 *
 * Writes eval/reports/supplier-learning-<provider>-<set>.{json,md}. Model answers are cached like the
 * extraction evaluation (LLM_CACHE_MODE=replay reruns it with no model).
 */

const DOCS: { file: string; type: ExtractableType; key: 'invoice' | 'packingList' | 'billOfLading' }[] = [
  { file: 'invoice.pdf', type: 'COMMERCIAL_INVOICE', key: 'invoice' },
  { file: 'packing-list.pdf', type: 'PACKING_LIST', key: 'packingList' },
  { file: 'bill-of-lading.pdf', type: 'BILL_OF_LADING', key: 'billOfLading' },
];

interface Truth {
  id: string;
  documents: { invoice: CommercialInvoice; packingList: PackingList; billOfLading: BillOfLading };
}

interface DocRun {
  shipment: string;
  type: ExtractableType;
  supplier: string;
  /** Examples given to the model for this document (0: same prompt as the baseline). */
  examples: number;
  baseline: FieldScore[];
  learning: FieldScore[];
  /** Examples the reviewer's corrections of this document added. */
  learned: number;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const supplierOf = (truth: Truth, key: (typeof DOCS)[number]['key']) =>
  key === 'billOfLading' ? truth.documents.billOfLading.shipper.name : (truth.documents[key] as CommercialInvoice | PackingList).seller?.name ?? '';

async function main() {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data/eval/v1' },
      out: { type: 'string', default: 'eval/reports' },
      limit: { type: 'string' },
      examples: { type: 'string', default: String(DEFAULT_SUPPLIER_EXAMPLES) },
    },
  });
  const dataDir = resolve(values.data!);
  const env = { ...process.env };
  const base = llmFromEnv(env);
  const cacheDir = env.LLM_CACHE_DIR || join('eval/cache', base.provider.id.replace(/[^\w.-]+/g, '_'));
  const llm = new LlmClient(base.provider, cacheDir, (env.LLM_CACHE_MODE as 'readwrite' | 'replay' | 'off') || 'readwrite');
  const limit = Number(values.examples);

  let ids = (await readdir(dataDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (values.limit) ids = ids.slice(0, Number(values.limit));
  console.log(`Supplier learning on ${ids.length} shipments of ${basename(dataDir)} with ${base.provider.id}, up to ${limit} examples per document`);

  // What the reviewer taught so far, per supplier: newest first, one per document type and field.
  const store = new Map<string, { name: string; examples: SupplierExample[] }>();
  const runs: DocRun[] = [];
  const started = Date.now();

  for (const id of ids) {
    const dir = join(dataDir, id);
    const truth = JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8')) as Truth;
    for (const d of DOCS) {
      if (!existsSync(join(dir, d.file))) continue;
      const bytes = new Uint8Array(await readFile(join(dir, d.file)));
      const expected = truth.documents[d.key];
      const baseline = await extractDocument(bytes, llm);
      const baselineScores = scoreDocument(d.type, expected, baseline.documentType === d.type ? (baseline.data ?? baseline.partial ?? null) : null);

      // The supplier is recognized in the text, as in the app, among the suppliers with examples.
      const known = [...store.entries()].map(([key, s]) => ({ key, name: s.name }));
      const supplier = detectSupplier(baseline.pdf, known);
      const examples = supplier ? store.get(supplier.key)!.examples.filter((e) => e.documentType === d.type).slice(0, limit) : [];
      const learning = examples.length ? await extractDocument(bytes, llm, undefined, { supplier: { supplier: supplier!.name, examples } }) : baseline;
      const learningScores = examples.length ? scoreDocument(d.type, expected, learning.documentType === d.type ? (learning.data ?? learning.partial ?? null) : null) : baselineScores;

      // The reviewer corrects what the app showed (the learning run) and the corrections are kept.
      const name = supplierOf(truth, d.key);
      const key = supplierKey(name);
      let learned = 0;
      for (const s of learningScores) {
        if (s.outcome === 'correct' || s.expected === null || s.expected === undefined || typeof s.expected === 'object') continue;
        const example = exampleFromCorrection({ documentType: d.type, path: fieldPointer(s.field), newValue: s.expected, raw: learning.raw, pdf: learning.pdf });
        if (!example) continue;
        const entry = store.get(key) ?? { name, examples: [] };
        entry.examples = [example, ...entry.examples.filter((e) => !(e.documentType === example.documentType && e.field === example.field))];
        store.set(key, entry);
        learned++;
      }
      runs.push({ shipment: id, type: d.type, supplier: name, examples: examples.length, baseline: baselineScores, learning: learningScores, learned });
      const b = tally(baselineScores);
      const l = tally(learningScores);
      console.log(`${id} ${d.type.padEnd(18)} ${examples.length ? `${examples.length} ex.` : '      '} baseline ${pct(b.accuracy)}  learning ${pct(l.accuracy)}${learned ? `  +${learned} learned` : ''}`);
    }
  }
  await terminateOcr();

  const all = (pick: (r: DocRun) => FieldScore[], filter: (r: DocRun) => boolean = () => true) => tally(runs.filter(filter).flatMap(pick));
  const affected = (r: DocRun) => r.examples > 0;
  const weights = (scores: FieldScore[]) => scores.filter((s) => /Weight\.kg$/.test(s.pattern));
  const summary = {
    provider: base.provider.id,
    set: basename(dataDir),
    shipments: ids.length,
    documents: runs.length,
    examplesPerDocument: limit,
    documentsWithExamples: runs.filter(affected).length,
    suppliers: [...store.entries()].map(([key, s]) => ({ key, name: s.name, examples: s.examples.length })),
    overall: { baseline: all((r) => r.baseline), learning: all((r) => r.learning) },
    withExamples: { baseline: all((r) => r.baseline, affected), learning: all((r) => r.learning, affected) },
    weightFields: { baseline: all((r) => weights(r.baseline)), learning: all((r) => weights(r.learning)) },
    minutes: Math.round((Date.now() - started) / 600) / 100,
  };
  const name = `supplier-learning-${base.provider.id.replace(/[^\w.-]+/g, '_')}-${basename(dataDir)}`;
  await mkdir(values.out!, { recursive: true });
  await writeFile(join(values.out!, `${name}.json`), JSON.stringify({ ...summary, runs: runs.map(({ baseline, learning, ...r }) => ({ ...r, baseline: tally(baseline), learning: tally(learning) })) }, null, 2) + '\n');
  const row = (label: string, x: { baseline: ReturnType<typeof tally>; learning: ReturnType<typeof tally> }) =>
    `| ${label} | ${x.baseline.total} | ${pct(x.baseline.accuracy)} | ${pct(x.learning.accuracy)} | ${x.baseline.correct} → ${x.learning.correct} |`;
  const md = `# Supplier learning: ${summary.set} (${summary.provider})

${summary.shipments} shipments, ${summary.documents} documents in order; ${summary.documentsWithExamples} were extracted with examples (up to ${limit} per document) from earlier corrections of the same supplier. Baseline: the same documents with no examples.

| Fields | Scored | Baseline | With learning | Correct |
| --- | --- | --- | --- | --- |
${row('All documents', summary.overall)}
${row('Documents given examples', summary.withExamples)}
${row('Net and gross weights', summary.weightFields)}

Suppliers with examples at the end: ${summary.suppliers.map((s) => `${s.name} (${s.examples})`).join(', ') || 'none'}.
`;
  await writeFile(join(values.out!, `${name}.md`), md);
  console.log(`\n${md}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
