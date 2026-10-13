import { runRules, type ShipmentContext } from '@doccheck/rules';
import type { BillOfLading, CommercialInvoice, Destination, Isf, PackingList } from '@doccheck/schemas';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { extractDocument, PROMPT_VERSION, type ExtractableType } from './extract';
import { LlmClient, llmFromEnv, type Usage } from './llm';
import { terminateOcr } from './ocr';
import { scoreDocument, tally, type FieldScore } from './score';

/**
 * Runs extraction over the evaluation set and writes eval/reports/extraction-<provider>.{json,md}.
 *
 *   LLM_MODEL=qwen3.8 node dist/eval-cli.js --limit 10
 *   LLM_CACHE_MODE=replay node dist/eval-cli.js        # CI: cached responses only
 *   node dist/eval-cli.js --data data/eval/v1-isf      # ISF confirmations (npm run synth -- --isf-pdfs)
 *
 * Only the PDFs present in a shipment folder are extracted. For the rules, a document without a
 * PDF in the folder (the invoice in v1-isf) comes from truth.json.
 */

const DOCS: { file: string; type: ExtractableType; key: 'invoice' | 'packingList' | 'billOfLading' | 'isf'; template: string }[] = [
  { file: 'invoice.pdf', type: 'COMMERCIAL_INVOICE', key: 'invoice', template: 'invoiceTemplate' },
  { file: 'packing-list.pdf', type: 'PACKING_LIST', key: 'packingList', template: 'packingListTemplate' },
  { file: 'bill-of-lading.pdf', type: 'BILL_OF_LADING', key: 'billOfLading', template: 'blTemplate' },
  { file: 'isf.pdf', type: 'ISF', key: 'isf', template: 'isfTemplate' },
];


interface Truth {
  id: string;
  destination: Destination;
  render: Record<string, string | boolean>;
  documents: { invoice: CommercialInvoice; packingList: PackingList; billOfLading: BillOfLading; isf?: Isf };
}

interface DocResult {
  shipment: string;
  type: ExtractableType;
  template: string;
  detectedType: string;
  scores: FieldScore[];
  issues: string[];
  error?: string;
  usage?: Usage;
  cached: boolean;
}

interface ShipmentResult {
  id: string;
  expectedRules: string[];
  rulesOnTruth: string[];
  rulesOnExtracted: string[] | null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const { values } = parseArgs({
    options: {
      data: { type: 'string', default: 'data/eval/v1' },
      out: { type: 'string', default: 'eval/reports' },
      limit: { type: 'string' },
      ids: { type: 'string' },
      concurrency: { type: 'string', default: '2' },
    },
  });
  const dataDir = resolve(values.data!);
  const env = { ...process.env };
  const base = llmFromEnv(env);
  const cacheDir = env.LLM_CACHE_DIR || join('eval/cache', base.provider.id.replace(/[^\w.-]+/g, '_'));
  const llm = new LlmClient(base.provider, cacheDir, (env.LLM_CACHE_MODE as 'readwrite' | 'replay' | 'off') || 'readwrite');

  let ids = (await readdir(dataDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (values.ids) ids = ids.filter((id) => values.ids!.split(',').includes(id));
  if (values.limit) {
    // Take the first N of each country so a small run still covers both profiles.
    const n = Number(values.limit);
    ids = [...ids.filter((i) => i.startsWith('CA')).slice(0, Math.ceil(n / 2)), ...ids.filter((i) => i.startsWith('US')).slice(0, Math.floor(n / 2))];
  }

  const pdfCount = ids.reduce((n, id) => n + DOCS.filter((d) => existsSync(join(dataDir, id, d.file))).length, 0);
  console.log(`Extracting ${ids.length} shipments (${pdfCount} PDFs) with ${base.provider.id}, cache ${cacheDir}`);
  const docResults: DocResult[] = [];
  const shipmentResults: ShipmentResult[] = [];
  const started = Date.now();
  let done = 0;

  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const dir = join(dataDir, id);
      const truth = JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8')) as Truth;
      const labels = JSON.parse(await readFile(join(dir, 'labels.json'), 'utf8')) as { errors: { expectedRuleIds: string[] }[] };
      const extracted: Partial<Truth['documents']> = {};
      const present = DOCS.filter((d) => existsSync(join(dir, d.file)));

      for (const d of present) {
        const result: DocResult = { shipment: id, type: d.type, template: String(truth.render[d.template]), detectedType: '', scores: [], issues: [], cached: false };
        try {
          const pdf = await readFile(join(dir, d.file));
          const out = await extractDocument(pdf, llm);
          result.detectedType = out.documentType;
          result.issues = out.issues;
          result.usage = out.usage;
          result.cached = out.cached;
          // Score against the expected type even if classification failed: that is a miss on every field.
          result.scores = scoreDocument(d.type, truth.documents[d.key], out.documentType === d.type ? out.data : null);
          if (out.documentType === d.type && out.data) (extracted as Record<string, unknown>)[d.key] = out.data;
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          result.scores = scoreDocument(d.type, truth.documents[d.key], null);
        }
        docResults.push(result);
      }

      const ctx = (docs: Partial<Truth['documents']>): ShipmentContext => ({
        shipmentId: id,
        destination: truth.destination,
        invoice: docs.invoice && { id: 'invoice', data: docs.invoice },
        packingList: docs.packingList && { id: 'packingList', data: docs.packingList },
        billOfLading: docs.billOfLading && { id: 'billOfLading', data: docs.billOfLading },
        isf: docs.isf && { id: 'isf', data: docs.isf },
      });
      // Paper documents with no PDF in this set come from the truth, so the rules see a whole shipment.
      // The ISF only counts when its PDF is in the set, so v1 reports stay comparable (X11 is not run there).
      const fromTruth = Object.fromEntries(DOCS.filter((d) => d.key !== 'isf' && !present.includes(d)).map((d) => [d.key, truth.documents[d.key]]));
      const truthDocs = present.some((d) => d.key === 'isf') ? truth.documents : { ...truth.documents, isf: undefined };
      const ruleIds = (docs: Partial<Truth['documents']>) => [...new Set(runRules(ctx(docs)).findings.map((f) => f.ruleId))].sort();
      shipmentResults.push({
        id,
        expectedRules: [...new Set(labels.errors.flatMap((e) => e.expectedRuleIds))].sort(),
        rulesOnTruth: ruleIds(truthDocs),
        rulesOnExtracted: Object.keys(extracted).length === present.length ? ruleIds({ ...fromTruth, ...extracted }) : null,
      });
      done++;
      if (done % 5 === 0 || done === ids.length) console.log(`  ${done}/${ids.length} shipments (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  };
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  docResults.sort((a, b) => a.shipment.localeCompare(b.shipment) || a.type.localeCompare(b.type));
  shipmentResults.sort((a, b) => a.id.localeCompare(b.id));

  // ---- aggregate
  const all = docResults.flatMap((r) => r.scores);
  const byType = DOCS.filter((d) => docResults.some((r) => r.type === d.type)).map((d) => ({ type: d.type, ...tally(docResults.filter((r) => r.type === d.type).flatMap((r) => r.scores)) }));
  const templates = [...new Set(docResults.map((r) => `${r.type} · ${r.template}`))].sort();
  const byTemplate = templates.map((t) => ({ template: t, ...tally(docResults.filter((r) => `${r.type} · ${r.template}` === t).flatMap((r) => r.scores)) }));
  const patterns = [...new Set(all.map((s) => `${s.pattern}`))];
  const byField = DOCS.flatMap((d) =>
    patterns
      .map((p) => ({ type: d.type, field: p, ...tally(docResults.filter((r) => r.type === d.type).flatMap((r) => r.scores.filter((s) => s.pattern === p))) }))
      .filter((f) => f.total > 0),
  ).sort((a, b) => a.accuracy - b.accuracy);
  const classification = docResults.filter((r) => !r.error).length
    ? docResults.filter((r) => r.detectedType === r.type).length / docResults.length
    : 0;

  const rules = [...new Set(shipmentResults.flatMap((s) => [...s.expectedRules, ...s.rulesOnTruth, ...(s.rulesOnExtracted ?? [])]))].sort();
  const usable = shipmentResults.filter((s) => s.rulesOnExtracted);
  const ruleTable = rules.map((rule) => {
    const row = { rule, tp: 0, fp: 0, fn: 0 };
    for (const s of usable) {
      const exp = s.expectedRules.includes(rule);
      const got = s.rulesOnExtracted!.includes(rule);
      if (exp && got) row.tp++;
      else if (got) row.fp++;
      else if (exp) row.fn++;
    }
    return { ...row, recall: row.tp + row.fn ? row.tp / (row.tp + row.fn) : null, precision: row.tp + row.fp ? row.tp / (row.tp + row.fp) : null };
  });

  const usage = docResults.reduce((acc, r) => ({ inputTokens: acc.inputTokens + (r.usage?.inputTokens ?? 0), outputTokens: acc.outputTokens + (r.usage?.outputTokens ?? 0) }), { inputTokens: 0, outputTokens: 0 });
  const seconds = Math.round((Date.now() - started) / 1000);
  const errors = docResults.filter((r) => r.error);

  const report = {
    provider: base.provider.id,
    modelVersion: await base.provider.version?.(),
    promptVersion: PROMPT_VERSION,
    shipments: ids.length,
    documents: docResults.length,
    failedDocuments: errors.length,
    cachedDocuments: docResults.filter((r) => r.cached).length,
    classificationAccuracy: classification,
    overall: tally(all),
    byType,
    byTemplate,
    byField,
    rules: { shipmentsWithAllDocuments: usable.length, table: ruleTable },
    usage: { ...usage, seconds },
    documentsDetail: docResults.map((r) => ({ ...r, scores: r.scores.filter((s) => s.outcome !== 'correct') })),
    shipmentsDetail: shipmentResults,
  };

  const outDir = resolve(values.out!);
  await mkdir(outDir, { recursive: true });
  const set = basename(dataDir) === 'v1' ? '' : `-${basename(dataDir)}`;
  const name = `extraction-${base.provider.id.replace(/[^\w.-]+/g, '_')}${set}`;
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');

  const md = [
    `# Extraction report — ${base.provider.id}`,
    '',
    `Data \`${basename(dataDir)}\` · model build ${report.modelVersion ?? 'unknown'} · prompt \`${PROMPT_VERSION}\` · ${ids.length} shipments · ${docResults.length} PDFs · ${errors.length} failed · ${report.cachedDocuments} from cache`,
    '',
    `**Field accuracy ${pct(report.overall.accuracy)}** (${report.overall.correct}/${report.overall.total}: ${report.overall.wrong} wrong, ${report.overall.missing} missing, ${report.overall.spurious} spurious) · classification ${pct(classification)}`,
    '',
    '| Document | Accuracy | Correct | Wrong | Missing | Spurious |',
    '| --- | --- | --- | --- | --- | --- |',
    ...byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${t.correct} | ${t.wrong} | ${t.missing} | ${t.spurious} |`),
    '',
    '## By template',
    '',
    '| Template | Accuracy | Fields |',
    '| --- | --- | --- |',
    ...byTemplate.map((t) => `| ${t.template} | ${pct(t.accuracy)} | ${t.total} |`),
    '',
    '## Weakest fields',
    '',
    '| Document | Field | Accuracy | Wrong | Missing | Spurious |',
    '| --- | --- | --- | --- | --- | --- |',
    ...byField.filter((f) => f.accuracy < 1).slice(0, 15).map((f) => `| ${f.type} | \`${f.field}\` | ${pct(f.accuracy)} | ${f.wrong} | ${f.missing} | ${f.spurious} |`),
    '',
    '## Rules on extracted documents vs injected errors',
    '',
    `${usable.length} of ${shipmentResults.length} shipments had all their PDFs extracted.`,
    '',
    '| Rule | Recall | Precision | TP | FP | FN |',
    '| --- | --- | --- | --- | --- | --- |',
    ...ruleTable.map((r) => `| ${r.rule} | ${r.recall === null ? '—' : pct(r.recall)} | ${r.precision === null ? '—' : pct(r.precision)} | ${r.tp} | ${r.fp} | ${r.fn} |`),
    '',
    `Tokens: ${usage.inputTokens.toLocaleString('en-US')} in / ${usage.outputTokens.toLocaleString('en-US')} out · ${seconds} s wall clock (cached documents count the tokens of the original call).`,
    ...(errors.length ? ['', '## Failures', '', ...errors.slice(0, 20).map((e) => `- ${e.shipment} ${e.type}: ${e.error}`)] : []),
    '',
  ].join('\n');
  await writeFile(join(outDir, `${name}.md`), md);
  console.log(`\n${md}`);
  console.log(`Report: ${join(outDir, name)}.{md,json}`);
  await terminateOcr();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
