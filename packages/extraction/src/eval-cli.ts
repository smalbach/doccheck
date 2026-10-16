import { runRules, type ShipmentContext } from '@doccheck/rules';
import type { Attestation, BillOfLading, CommercialInvoice, Destination, Isf, PackingList } from '@doccheck/schemas';
import { detectAttestation } from './attestation';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { extractDocument, PROMPT_VERSION, type ExtractableType } from './extract';
import { LlmClient, llmFromEnv, type Usage } from './llm';
import { ocrEngine, terminateOcr } from './ocr';
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

type DocKey = 'invoice' | 'packingList' | 'billOfLading' | 'isf' | 'airWaybill' | 'certificateOfOrigin' | 'cusmaCertification' | 'arrivalNotice' | 'woodPackaging' | 'dangerousGoods';

const DOCS: { file: string; type: ExtractableType; key: DocKey; template: string }[] = [
  { file: 'invoice.pdf', type: 'COMMERCIAL_INVOICE', key: 'invoice', template: 'invoiceTemplate' },
  { file: 'packing-list.pdf', type: 'PACKING_LIST', key: 'packingList', template: 'packingListTemplate' },
  { file: 'bill-of-lading.pdf', type: 'BILL_OF_LADING', key: 'billOfLading', template: 'blTemplate' },
  { file: 'isf.pdf', type: 'ISF', key: 'isf', template: 'isfTemplate' },
  // Set v1-docs (npm run synth -- --docs): one layout each.
  { file: 'air-waybill.pdf', type: 'AIR_WAYBILL', key: 'airWaybill', template: '' },
  { file: 'certificate-of-origin.pdf', type: 'CERTIFICATE_OF_ORIGIN', key: 'certificateOfOrigin', template: '' },
  { file: 'cusma-certification.pdf', type: 'CUSMA_CERTIFICATION', key: 'cusmaCertification', template: '' },
  { file: 'arrival-notice.pdf', type: 'ARRIVAL_NOTICE', key: 'arrivalNotice', template: '' },
  { file: 'wood-packaging.pdf', type: 'WOOD_PACKAGING_CERTIFICATE', key: 'woodPackaging', template: '' },
  { file: 'dangerous-goods.pdf', type: 'DANGEROUS_GOODS_DECLARATION', key: 'dangerousGoods', template: '' },
];

/** Documents whose paper is checked for a signature and a stamp (rule T13), as the API does. */
const ATTESTED = new Set<DocKey>(['certificateOfOrigin', 'cusmaCertification']);


interface Truth {
  id: string;
  destination: Destination;
  render: Record<string, string | boolean>;
  documents: { invoice: CommercialInvoice; packingList: PackingList; billOfLading: BillOfLading; isf?: Isf } & Partial<Record<DocKey, unknown>>;
  /** v1-docs: whether each certificate is signed and stamped on paper. */
  attestations?: Partial<Record<DocKey, Attestation>>;
}

interface DocResult {
  shipment: string;
  type: ExtractableType;
  template: string;
  detectedType: string;
  /** The normalized document passed schema validation, so the rules can use it. */
  valid: boolean;
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
      const attestations: Partial<Record<DocKey, Attestation>> = {};

      for (const d of present) {
        const result: DocResult = { shipment: id, type: d.type, template: d.template ? String(truth.render[d.template]) : 'classic', detectedType: '', valid: false, scores: [], issues: [], cached: false };
        try {
          const pdf = await readFile(join(dir, d.file));
          const out = await extractDocument(pdf, llm);
          result.detectedType = out.documentType;
          result.issues = out.issues;
          result.usage = out.usage;
          result.cached = out.cached;
          // Score against the expected type even if classification failed: that is a miss on every field.
          // A document that fails validation is scored on what was read (out.partial) and counted as
          // invalid separately: field accuracy measures reading, validity whether the rules can run.
          result.valid = out.documentType === d.type && !!out.data;
          result.scores = scoreDocument(d.type, truth.documents[d.key], out.documentType === d.type ? (out.data ?? out.partial ?? null) : null);
          if (out.documentType === d.type && out.data) (extracted as Record<string, unknown>)[d.key] = out.data;
          if (ATTESTED.has(d.key)) attestations[d.key] = await detectAttestation(pdf, out.pdf);
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          result.scores = scoreDocument(d.type, truth.documents[d.key], null);
        }
        docResults.push(result);
      }

      // Each document is cited by its key; the paper's signature and stamp go with the certificates.
      const ctx = (docs: Partial<Truth['documents']>, seen: Partial<Record<DocKey, Attestation>>): ShipmentContext => {
        const c: ShipmentContext = { shipmentId: id, destination: truth.destination };
        for (const d of DOCS) if (docs[d.key]) Object.assign(c, { [d.key]: { id: d.key, data: docs[d.key] } });
        const kept = Object.fromEntries(Object.entries(seen).filter(([k]) => docs[k as DocKey]));
        if (Object.keys(kept).length) c.attestations = kept;
        return c;
      };
      // Paper documents with no PDF in this set come from the truth, so the rules see a whole shipment.
      // The ISF only counts when its PDF is in the set, so v1 reports stay comparable (X11 is not run there).
      const fromTruth = Object.fromEntries(DOCS.filter((d) => d.key !== 'isf' && !present.includes(d) && truth.documents[d.key]).map((d) => [d.key, truth.documents[d.key]]));
      const truthDocs = present.some((d) => d.key === 'isf') ? truth.documents : { ...truth.documents, isf: undefined };
      const ruleIds = (docs: Partial<Truth['documents']>, seen: Partial<Record<DocKey, Attestation>>) => [...new Set(runRules(ctx(docs, seen)).findings.map((f) => f.ruleId))].sort();
      shipmentResults.push({
        id,
        expectedRules: [...new Set(labels.errors.flatMap((e) => e.expectedRuleIds))].sort(),
        rulesOnTruth: ruleIds(truthDocs, truth.attestations ?? {}),
        rulesOnExtracted: Object.keys(extracted).length === present.length ? ruleIds({ ...fromTruth, ...extracted }, attestations) : null,
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
  const byType = DOCS.filter((d) => docResults.some((r) => r.type === d.type)).map((d) => {
    const docs = docResults.filter((r) => r.type === d.type);
    return { type: d.type, documents: docs.length, validDocuments: docs.filter((r) => r.valid).length, ...tally(docs.flatMap((r) => r.scores)) };
  });
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
    /** OCR engine for pages without a text layer (OCR_ENGINE). */
    ocrEngine: ocrEngine(),
    shipments: ids.length,
    documents: docResults.length,
    failedDocuments: errors.length,
    cachedDocuments: docResults.filter((r) => r.cached).length,
    classificationAccuracy: classification,
    validDocuments: docResults.filter((r) => r.valid).length,
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
  // Another OCR engine gets its own report, so it sits next to the tesseract one: ...-v1-scans-unlimited.
  const set = `${basename(dataDir) === 'v1' ? '' : `-${basename(dataDir)}`}${ocrEngine() === 'tesseract' ? '' : `-${ocrEngine()}`}`;
  const name = `extraction-${base.provider.id.replace(/[^\w.-]+/g, '_')}${set}`;
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');

  const md = [
    `# Extraction report — ${base.provider.id}`,
    '',
    `Data \`${basename(dataDir)}\` · model build ${report.modelVersion ?? 'unknown'} · prompt \`${PROMPT_VERSION}\` · OCR ${report.ocrEngine} · ${ids.length} shipments · ${docResults.length} PDFs · ${errors.length} failed · ${report.cachedDocuments} from cache`,
    '',
    `**Field accuracy ${pct(report.overall.accuracy)}** (${report.overall.correct}/${report.overall.total}: ${report.overall.wrong} wrong, ${report.overall.missing} missing, ${report.overall.spurious} spurious) · classification ${pct(classification)} · ${report.validDocuments}/${docResults.length} documents valid (rules can run on them)`,
    '',
    '| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...byType.map((t) => `| ${t.type} | ${pct(t.accuracy)} | ${t.correct} | ${t.wrong} | ${t.missing} | ${t.spurious} | ${t.validDocuments}/${t.documents} |`),
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
