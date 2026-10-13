import type { BillOfLading, CommercialInvoice, DocumentType, PackingList } from '@doccheck/schemas';
import type { z } from 'zod';
import { classifyDocument } from './classify';
import type { LlmClient, Usage } from './llm';
import { normalizeBillOfLading, normalizeInvoice, normalizePackingList, type NormalizeResult } from './normalize';
import { readPdfText, type PdfText } from './pdf-text';
import { RawBillOfLading, RawInvoice, RawPackingList } from './raw-schemas';

/** Bump when a prompt changes, so cached responses from the old prompt are not reused. */
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
};

export type ExtractableType = 'COMMERCIAL_INVOICE' | 'PACKING_LIST' | 'BILL_OF_LADING';

type Canonical = { COMMERCIAL_INVOICE: CommercialInvoice; PACKING_LIST: PackingList; BILL_OF_LADING: BillOfLading };

const PIPELINES: { [K in ExtractableType]: { schema: z.ZodType; normalize: (raw: never) => NormalizeResult<Canonical[K]> } } = {
  COMMERCIAL_INVOICE: { schema: RawInvoice, normalize: normalizeInvoice },
  PACKING_LIST: { schema: RawPackingList, normalize: normalizePackingList },
  BILL_OF_LADING: { schema: RawBillOfLading, normalize: normalizeBillOfLading },
};

export interface ExtractionResult<T = CommercialInvoice | PackingList | BillOfLading> {
  documentType: DocumentType;
  typeConfidence: number;
  pdf: PdfText;
  /** Values as printed, from the model. */
  raw: unknown;
  /** Normalized document; null when a required field is missing or unreadable. */
  data: T | null;
  issues: string[];
  usage?: Usage;
  cached: boolean;
}

export async function extractFromText<K extends ExtractableType>(pdf: PdfText, type: K, llm: LlmClient): Promise<Omit<ExtractionResult<Canonical[K]>, 'documentType' | 'typeConfidence' | 'pdf'>> {
  const pipeline = PIPELINES[type];
  const { output, usage, cached } = await llm.call(PROMPT_VERSION, {
    system: `${COMMON}\n\n${SPECIFIC[type]}`,
    user: `<document>\n${pdf.text}\n</document>`,
    schema: pipeline.schema,
  });
  const { data, issues } = pipeline.normalize(output as never);
  return { raw: output, data, issues, usage, cached };
}

/** PDF bytes -> classified, extracted and normalized document. `type` skips classification. */
export async function extractDocument(pdfBytes: Uint8Array, llm: LlmClient, type?: ExtractableType): Promise<ExtractionResult> {
  const pdf = await readPdfText(pdfBytes);
  if (pdf.lines.length === 0) {
    return { documentType: 'UNKNOWN', typeConfidence: 0, pdf, raw: null, data: null, issues: ['No text layer: the PDF is probably a scan (OCR not implemented yet)'], cached: false };
  }
  const detected = type ? { type, confidence: 1 } : classifyDocument(pdf.text);
  if (!(detected.type in PIPELINES)) {
    return { documentType: detected.type, typeConfidence: detected.confidence, pdf, raw: null, data: null, issues: [`Unsupported document type ${detected.type}`], cached: false };
  }
  const result = await extractFromText(pdf, detected.type as ExtractableType, llm);
  return { documentType: detected.type, typeConfidence: detected.confidence, pdf, ...result };
}
