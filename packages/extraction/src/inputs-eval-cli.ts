import { runRules, type ShipmentContext } from '@doccheck/rules';
import type { BillOfLading, CommercialInvoice, Destination, Isf, PackingList } from '@doccheck/schemas';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { extractFromPdfText, PROMPT_VERSION } from './extract';
import { prepareImage } from './image';
import { LlmClient } from './llm';
import { llmFromEnv } from './llm-providers';
import { ocrEngine, terminateOcr } from './ocr';
import { readPdfText } from './pdf-text';
import { scoreDocument, tally, type FieldScore } from './score';
import { splitDocuments } from './split';
import { readSpreadsheet } from './spreadsheet';
import { extractSheets } from './spreadsheet-extract';

/**
 * Scores the other input formats on set v1-inputs (npm run synth -- --inputs) and writes
 * eval/reports/inputs-<provider>.{json,md}:
 *   spreadsheets  invoice.xlsx and packing-list.csv read without a model (the model only maps headers it cannot)
 *   photos        invoice.jpg straightened, cropped, read with OCR and extracted by the model
 *   combined      combined.pdf split into its documents by page; scored on type and pages of each
 * The shipments are clean, so any finding the rules raise on what was read is a false positive.
 *
 *   node dist/inputs-eval-cli.js [--data data/eval/v1-inputs] [--skip-photos]
 */

interface Truth {
  id: string;
  destination: Destination;
  combined: { document: string; pages: number[] }[];
  documents: { invoice: CommercialInvoice; packingList: PackingList; billOfLading: BillOfLading; isf?: Isf };
}

const TYPE_OF: Record<string, string> = { invoice: 'COMMERCIAL_INVOICE', 'packing-list': 'PACKING_LIST', 'bill-of-lading': 'BILL_OF_LADING' };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string', default: 'data/eval/v1-inputs' }, out: { type: 'string', default: 'eval/reports' }, 'skip-photos': { type: 'boolean', default: false } } });
  const dataDir = resolve(values.data!);
  const base = llmFromEnv(process.env);
  const cacheDir = process.env.LLM_CACHE_DIR || join('eval/cache', base.provider.id.replace(/[^\w.-]+/g, '_'));
  const llm = new LlmClient(base.provider, cacheDir, (process.env.LLM_CACHE_MODE as 'readwrite' | 'replay' | 'off') || 'readwrite');
  const ids = (await readdir(dataDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const started = Date.now();

  const sheetScores: Record<'invoice' | 'packingList', FieldScore[]> = { invoice: [], packingList: [] };
  const sheetValid = { invoice: 0, packingList: 0 };
  let byModel = 0;
  let sheetFindings = 0;
  const photoScores: FieldScore[] = [];
  const photo = { documents: 0, classified: 0, valid: 0, findings: 0, angleError: [] as number[] };
  const combined = { files: 0, documents: 0, exact: 0, pages: 0, pagesRight: 0 };
  const detail: unknown[] = [];

  const rulesOn = (truth: Truth, docs: Partial<Truth['documents']>) => {
    const d = { ...truth.documents, ...docs, isf: undefined };
    const ctx: ShipmentContext = { shipmentId: truth.id, destination: truth.destination, invoice: { id: 'invoice', data: d.invoice }, packingList: { id: 'packingList', data: d.packingList }, billOfLading: { id: 'billOfLading', data: d.billOfLading } };
    return runRules(ctx).findings.map((f) => f.ruleId);
  };

  for (const id of ids) {
    const dir = join(dataDir, id);
    const truth = JSON.parse(await readFile(join(dir, 'truth.json'), 'utf8')) as Truth;
    const row: Record<string, unknown> = { id };

    const inv = await extractSheets(readSpreadsheet(await readFile(join(dir, 'invoice.xlsx')), 'invoice.xlsx'), undefined, { llm });
    const pl = await extractSheets(readSpreadsheet(await readFile(join(dir, 'packing-list.csv')), 'packing-list.csv'), undefined, { llm });
    sheetScores.invoice.push(...scoreDocument('COMMERCIAL_INVOICE', truth.documents.invoice, inv.documentType === 'COMMERCIAL_INVOICE' ? (inv.data ?? inv.partial ?? null) : null));
    sheetScores.packingList.push(...scoreDocument('PACKING_LIST', truth.documents.packingList, pl.documentType === 'PACKING_LIST' ? (pl.data ?? pl.partial ?? null) : null));
    if (inv.data) sheetValid.invoice++;
    if (pl.data) sheetValid.packingList++;
    byModel += (inv.table?.byModel.length ?? 0) + (pl.table?.byModel.length ?? 0);
    if (inv.data && pl.data) {
      const found = rulesOn(truth, { invoice: inv.data as CommercialInvoice, packingList: pl.data as PackingList });
      sheetFindings += found.length;
      row.sheetFindings = found;
    }
    row.sheetIssues = [...inv.issues, ...pl.issues];

    if (!values['skip-photos'] && existsSync(join(dir, 'invoice.jpg'))) {
      photo.documents++;
      const prepared = await prepareImage(await readFile(join(dir, 'invoice.jpg')), 'invoice.jpg');
      const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as { shipments: { id: string; photo?: { rotation: number } }[] };
      const drawn = manifest.shipments.find((s) => s.id === id)?.photo?.rotation;
      if (drawn !== undefined) photo.angleError.push(Math.abs(prepared.rotated - drawn));
      const text = await readPdfText(prepared.pdf);
      const out = await extractFromPdfText(text, llm);
      if (out.documentType === 'COMMERCIAL_INVOICE') photo.classified++;
      if (out.documentType === 'COMMERCIAL_INVOICE' && out.data) {
        photo.valid++;
        const found = rulesOn(truth, { invoice: out.data as CommercialInvoice });
        photo.findings += found.length;
        row.photoFindings = found;
      }
      photoScores.push(...scoreDocument('COMMERCIAL_INVOICE', truth.documents.invoice, out.documentType === 'COMMERCIAL_INVOICE' ? (out.data ?? out.partial ?? null) : null));
      row.photo = { rotated: prepared.rotated, drawn, ocrConfidence: text.ocrConfidence, issues: out.issues };
    }

    if (existsSync(join(dir, 'combined.pdf')) && truth.combined?.length) {
      combined.files++;
      const text = await readPdfText(await readFile(join(dir, 'combined.pdf')), { ocr: 'off' });
      const parts = splitDocuments(text);
      for (const want of truth.combined) {
        combined.documents++;
        if (parts.some((p) => p.type === TYPE_OF[want.document] && p.pages.join() === want.pages.join())) combined.exact++;
      }
      // Pages: each page in the part of the right type.
      for (const want of truth.combined) {
        for (const page of want.pages) {
          combined.pages++;
          if (parts.find((p) => p.pages.includes(page))?.type === TYPE_OF[want.document]) combined.pagesRight++;
        }
      }
      row.combined = parts.map((p) => `${p.type}:${p.pages.join(',')}`);
    }
    detail.push(row);
    console.log(`  ${id} done (${Math.round((Date.now() - started) / 1000)} s)`);
  }

  const report = {
    provider: base.provider.id,
    modelVersion: await base.provider.version?.(),
    promptVersion: PROMPT_VERSION,
    ocrEngine: ocrEngine(),
    shipments: ids.length,
    spreadsheets: {
      invoice: { documents: ids.length, valid: sheetValid.invoice, ...tally(sheetScores.invoice) },
      packingList: { documents: ids.length, valid: sheetValid.packingList, ...tally(sheetScores.packingList) },
      overall: tally([...sheetScores.invoice, ...sheetScores.packingList]),
      headersMappedByModel: byModel,
      findingsOnCleanShipments: sheetFindings,
    },
    photos: photo.documents
      ? { ...photo, ...tally(photoScores), meanAngleError: photo.angleError.reduce((a, b) => a + b, 0) / Math.max(1, photo.angleError.length), angleError: undefined }
      : null,
    combined: { ...combined, documentAccuracy: combined.documents ? combined.exact / combined.documents : null, pageAccuracy: combined.pages ? combined.pagesRight / combined.pages : null },
    seconds: Math.round((Date.now() - started) / 1000),
    detail,
  };
  const outDir = resolve(values.out!);
  await mkdir(outDir, { recursive: true });
  const name = `inputs-${base.provider.id.replace(/[^\w.-]+/g, '_')}`;
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  const sp = report.spreadsheets;
  const md = [
    `# Input formats report — ${base.provider.id}`,
    '',
    `Data \`v1-inputs\` · ${ids.length} clean shipments · prompt \`${PROMPT_VERSION}\` · OCR ${report.ocrEngine}`,
    '',
    '| Input | Documents | Field accuracy | Valid documents | Findings on clean shipments |',
    '| --- | --- | --- | --- | --- |',
    `| Invoice spreadsheet (.xlsx) | ${ids.length} | ${pct(sp.invoice.accuracy)} | ${sp.invoice.valid}/${ids.length} | ${sp.findingsOnCleanShipments} (with the CSV packing list) |`,
    `| Packing list spreadsheet (.csv) | ${ids.length} | ${pct(sp.packingList.accuracy)} | ${sp.packingList.valid}/${ids.length} | |`,
    ...(report.photos ? [`| Invoice photo (JPEG, OCR) | ${report.photos.documents} | ${pct(report.photos.accuracy)} | ${report.photos.valid}/${report.photos.documents} | ${report.photos.findings} |`] : []),
    '',
    `Spreadsheet headers mapped by the model: ${sp.headersMappedByModel}.${report.photos ? ` Photo deskew: mean error ${report.photos.meanAngleError.toFixed(2)}° against the rotation drawn; ${report.photos.classified}/${report.photos.documents} classified as invoices.` : ''}`,
    '',
    `Combined PDFs: ${combined.files} files, ${combined.exact}/${combined.documents} documents split with the right type and pages (${report.combined.documentAccuracy === null ? '—' : pct(report.combined.documentAccuracy)}), ${combined.pagesRight}/${combined.pages} pages in the right document.`,
    '',
  ].join('\n');
  await writeFile(join(outDir, `${name}.md`), md);
  console.log(`\n${md}`);
  await terminateOcr();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
