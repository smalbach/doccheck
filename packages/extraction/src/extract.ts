import { report, withStage, type BillOfLading, type CommercialInvoice, type DocumentType, type ExtractionDetail, type Isf, type PackingList, type ProgressCallback } from '@doccheck/schemas';
import type { z } from 'zod';
import { classifyDocument } from './classify';
import type { LlmClient, Usage } from './llm';
import { normalizeBillOfLading, normalizeInvoice, normalizeIsf, normalizePackingList, type NormalizeResult } from './normalize';
import { readPdfText, type PdfText } from './pdf-text';
import { RawBillOfLading, RawInvoice, RawIsf, RawPackingList } from './raw-schemas';

/**
 * Bump when a prompt changes, so cached responses from the old prompt are not reused. Adding a
 * document type does not need a bump: its own instructions are part of the cache key.
 */
export const PROMPT_VERSION = 'extract-v3';

const COMMON = `You extract data from freight documents for a customs pre-check.
The document text below was read from a PDF. Text is laid out by position: cells of the same column start at the same character offset, and a cell may wrap onto the next line in the same column.

Rules:
- Copy every value exactly as printed: keep thousand separators, date formats, units and capitalization. Do not convert, compute or round anything.
- If a field is not printed on the document, return null (or an empty array). Never infer a value from another field or from what is typical.
- If a value is printed twice with different values, use the one in the most specific place (the table row or the totals box for that field).
- Keep parties separate: name, street lines, city, region, postal code and country each go in their own field.`;

const SPECIFIC: Record<ExtractableType, string> = {
  COMMERCIAL_INVOICE: `This is a commercial invoice. Extract one entry in "lines" per item row, in order.
For each line, the currency fields are only for an amount printed with its own currency; the invoice currency goes in "currency".
List freight, insurance or packing charges printed on the invoice in "charges", with their currency as printed.`,
  PACKING_LIST: `This is a packing list. Extract one entry in "packages" per package row, in order, and the totals row separately.`,
  BILL_OF_LADING: `This is a bill of lading or sea waybill. Extract one entry in "containers" per container row.
"totalPackages" and "totalGrossWeight" come from the cargo description section, not from the container rows.`,
  ISF: `This is an Importer Security Filing (ISF 10+2) confirmation. Each of the ten data elements is labeled: copy each party into its own field (manufacturer, seller, buyer, ship-to party, consolidator), even when two of them are the same company.
The container stuffing location is an address. Copy the importer of record and consignee numbers, the country of origin and the HTSUS number as printed.`,
};

export type ExtractableType = 'COMMERCIAL_INVOICE' | 'PACKING_LIST' | 'BILL_OF_LADING' | 'ISF';

export const EXTRACTABLE_TYPES: ExtractableType[] = ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'ISF'];

type Canonical = { COMMERCIAL_INVOICE: CommercialInvoice; PACKING_LIST: PackingList; BILL_OF_LADING: BillOfLading; ISF: Isf };

const PIPELINES: { [K in ExtractableType]: { schema: z.ZodType; normalize: (raw: never) => NormalizeResult<Canonical[K]> } } = {
  COMMERCIAL_INVOICE: { schema: RawInvoice, normalize: normalizeInvoice },
  PACKING_LIST: { schema: RawPackingList, normalize: normalizePackingList },
  BILL_OF_LADING: { schema: RawBillOfLading, normalize: normalizeBillOfLading },
  ISF: { schema: RawIsf, normalize: normalizeIsf },
};

export interface ExtractionResult<T = CommercialInvoice | PackingList | BillOfLading | Isf> {
  documentType: DocumentType;
  typeConfidence: number;
  pdf: PdfText;
  /** Values as printed, from the model. */
  raw: unknown;
  /** Normalized document; null when a required field is missing or unreadable. */
  data: T | null;
  /** When `data` is null: the values that could be normalized (see NormalizeResult.partial). */
  partial?: unknown;
  issues: string[];
  usage?: Usage;
  cached: boolean;
}

/** The model request for a document of this type; also lets callers check the cache (`llm.isCached`). */
export function extractionRequest(pdf: PdfText, type: ExtractableType) {
  return {
    system: `${COMMON}\n\n${SPECIFIC[type]}`,
    user: `<document>\n${pdf.text}\n</document>`,
    schema: PIPELINES[type].schema,
  };
}

/** The model call (stage `extracting`), then normalization (stage `normalizing`). */
export async function extractFromText<K extends ExtractableType>(
  pdf: PdfText,
  type: K,
  llm: LlmClient,
  onProgress?: ProgressCallback<ExtractionDetail>,
): Promise<Omit<ExtractionResult<Canonical[K]>, 'documentType' | 'typeConfidence' | 'pdf'>> {
  const pipeline = PIPELINES[type];
  const model = llm.provider.id;
  const { output, usage, cached } = await withStage(
    onProgress,
    'extracting',
    () => llm.call(PROMPT_VERSION, extractionRequest(pdf, type)),
    (r) => ({ model, documentType: type, cached: r.cached, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens }),
    { model, documentType: type },
  );
  const { data, partial, issues } = await withStage(
    onProgress,
    'normalizing',
    async () => pipeline.normalize(output as never),
    (r) => ({ normalized: r.data !== null, issues: r.issues.length }),
  );
  return { raw: output, data, partial, issues, usage, cached };
}

export interface ExtractOptions {
  /** Stage updates: reading, ocr (scans only), classifying, extracting, normalizing. */
  onProgress?: ProgressCallback<ExtractionDetail>;
}

/** PDF bytes -> classified, extracted and normalized document. `type` skips classification. */
export async function extractDocument(pdfBytes: Uint8Array, llm: LlmClient, type?: ExtractableType, { onProgress }: ExtractOptions = {}): Promise<ExtractionResult> {
  const pdf = await withStage(onProgress, 'reading', () => readPdfText(pdfBytes, { onProgress }), (p) => ({ pages: p.pageCount, ...(p.ocrPages ? { ocrPages: p.ocrPages } : {}) }));
  if (pdf.lines.length === 0) {
    return { documentType: 'UNKNOWN', typeConfidence: 0, pdf, raw: null, data: null, issues: ['No readable text, even with OCR: the PDF may be blank or too degraded'], cached: false };
  }
  let detected: { type: DocumentType; confidence: number };
  if (type) {
    detected = { type, confidence: 1 };
    await report(onProgress, { stage: 'classifying', status: 'skipped', detail: { reason: 'type-given', documentType: type, confidence: 1 } });
  } else {
    detected = await withStage(onProgress, 'classifying', async () => classifyDocument(pdf.text), (d) => ({ documentType: d.type, confidence: d.confidence }));
  }
  if (!(detected.type in PIPELINES)) {
    return { documentType: detected.type, typeConfidence: detected.confidence, pdf, raw: null, data: null, issues: [`Unsupported document type ${detected.type}`], cached: false };
  }
  const result = await extractFromText(pdf, detected.type as ExtractableType, llm, onProgress);
  if (pdf.ocrPages) result.issues.unshift(`Read with OCR (page${pdf.ocrPages.length > 1 ? 's' : ''} ${pdf.ocrPages.join(', ')}, confidence ${pdf.ocrConfidence}%): check values against the scan`);
  return { documentType: detected.type, typeConfidence: detected.confidence, pdf, ...result };
}
