import {
  DOCUMENT_SCHEMAS, report, withStage, type AirWaybill, type ArrivalNotice, type BillOfLading, type CertificateOfOrigin, type CommercialInvoice, type CusmaCertification,
  type DangerousGoodsDeclaration, type DocumentType, type ExtractionDetail, type Isf, type PackingList, type ProgressCallback, type WoodPackagingCertificate,
} from '@doccheck/schemas';
import type { z } from 'zod';
import { classifyDocument } from './classify';
import type { LlmClient, Usage } from './llm';
import { dropUnprintedInvoiceValues } from './printed';
import { normalizeBillOfLading, normalizeInvoice, normalizeIsf, normalizePackingList, type NormalizeResult } from './normalize';
import {
  normalizeAirWaybill, normalizeArrivalNotice, normalizeCertificateOfOrigin, normalizeCusmaCertification, normalizeDangerousGoods, normalizeWoodPackaging,
} from './normalize-documents';
import { dropUnprintedValues } from './printed-documents';
import { readPdfText, type PdfText } from './pdf-text';
import { RawBillOfLading, RawInvoice, RawIsf, RawPackingList } from './raw-schemas';
import { RawAirWaybill, RawArrivalNotice, RawCertificateOfOrigin, RawCusmaCertification, RawDangerousGoods, RawWoodPackagingCertificate } from './raw-schemas-documents';
import { throttleOutput } from './stream';

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
  AIR_WAYBILL: `This is an air waybill (master or house). "awbNumber" is the number of this waybill, printed at the top and bottom; on a house waybill the master number it quotes goes in "masterAwbNumber".
Airports: the name and, only if printed, the three-letter IATA code. The goods table has a header row ("No. of pieces", "Gross weight", "kg / lb", "Chargeable weight", "Nature and quantity of goods") and the values on the rows below it, in the same columns: copy "numberOfPieces" from the pieces column, each weight from its column with the unit from the kg / lb column (K or L), and the charges code (PP, CC) as printed. Never compute a chargeable weight.`,
  CERTIFICATE_OF_ORIGIN: `This is a certificate of origin issued by a chamber of commerce or another authority. Extract one entry in "goods" per item row, in order.
"countryOfOrigin" only from the box or sentence that states where the goods originate, never from an address.`,
  CUSMA_CERTIFICATION: `This is a CUSMA / USMCA / T-MEC certification of origin. Copy each of its data elements from its own field: who certifies (the role marked), the certifier, exporter, producer and importer parties, each good with its HS classification and origin criterion, the blanket period, and the authorized signature's name, title and date.
If a field is left blank, return null: do not fill a party from another field and do not choose an origin criterion that is not printed.`,
  ARRIVAL_NOTICE: `This is an arrival notice from a carrier or forwarder. "transportDocumentNumber" is the bill of lading or air waybill number the notice is for. Labels are printed above their values: "packages" is the number printed under PACKAGES and "grossWeight" the value under GROSS WEIGHT. Extract one entry in "containers" per container row and one in "charges" per charge line.`,
  WOOD_PACKAGING_CERTIFICATE: `This is a certificate or declaration about wood packaging (fumigation or heat treatment certificate, ISPM 15 declaration, or a declaration that there is no wood packaging). Copy the title, the sentence that states what was treated or declared, the treatment and the ISPM 15 mark as printed.`,
  DANGEROUS_GOODS_DECLARATION: `This is a dangerous goods declaration. Extract one entry in "items" per dangerous good, in order, with its UN number, proper shipping name, class, subsidiary risk and packing group exactly as printed; a packing group that is not printed is null.`,
};

export type ExtractableType = Exclude<DocumentType, 'UNKNOWN'>;

export const EXTRACTABLE_TYPES: ExtractableType[] = [
  'COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'ISF', 'AIR_WAYBILL', 'CERTIFICATE_OF_ORIGIN', 'CUSMA_CERTIFICATION', 'ARRIVAL_NOTICE',
  'WOOD_PACKAGING_CERTIFICATE', 'DANGEROUS_GOODS_DECLARATION',
];

type Canonical = {
  COMMERCIAL_INVOICE: CommercialInvoice;
  PACKING_LIST: PackingList;
  BILL_OF_LADING: BillOfLading;
  ISF: Isf;
  AIR_WAYBILL: AirWaybill;
  CERTIFICATE_OF_ORIGIN: CertificateOfOrigin;
  CUSMA_CERTIFICATION: CusmaCertification;
  ARRIVAL_NOTICE: ArrivalNotice;
  WOOD_PACKAGING_CERTIFICATE: WoodPackagingCertificate;
  DANGEROUS_GOODS_DECLARATION: DangerousGoodsDeclaration;
};

/** Any normalized document. */
export type ExtractedDocument = Canonical[ExtractableType];

const PIPELINES: { [K in ExtractableType]: { schema: z.ZodType; normalize: (raw: never) => NormalizeResult<Canonical[K]> } } = {
  COMMERCIAL_INVOICE: { schema: RawInvoice, normalize: normalizeInvoice },
  PACKING_LIST: { schema: RawPackingList, normalize: normalizePackingList },
  BILL_OF_LADING: { schema: RawBillOfLading, normalize: normalizeBillOfLading },
  ISF: { schema: RawIsf, normalize: normalizeIsf },
  AIR_WAYBILL: { schema: RawAirWaybill, normalize: normalizeAirWaybill },
  CERTIFICATE_OF_ORIGIN: { schema: RawCertificateOfOrigin, normalize: normalizeCertificateOfOrigin },
  CUSMA_CERTIFICATION: { schema: RawCusmaCertification, normalize: normalizeCusmaCertification },
  ARRIVAL_NOTICE: { schema: RawArrivalNotice, normalize: normalizeArrivalNotice },
  WOOD_PACKAGING_CERTIFICATE: { schema: RawWoodPackagingCertificate, normalize: normalizeWoodPackaging },
  DANGEROUS_GOODS_DECLARATION: { schema: RawDangerousGoods, normalize: normalizeDangerousGoods },
};

export interface ExtractionResult<T = ExtractedDocument> {
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

/**
 * The model call (stage `extracting`), then normalization (stage `normalizing`). With `onProgress`, the
 * answer is streamed as ephemeral `extracting` progress events (OutputDelta) while it is written.
 * `signal` aborts the model call (and its stream: no delta is sent once it is aborted).
 */
export async function extractFromText<K extends ExtractableType>(
  pdf: PdfText,
  type: K,
  llm: LlmClient,
  onProgress?: ProgressCallback<ExtractionDetail>,
  signal?: AbortSignal,
): Promise<Omit<ExtractionResult<Canonical[K]>, 'documentType' | 'typeConfidence' | 'pdf'>> {
  const pipeline = PIPELINES[type];
  const model = llm.provider.id;
  const { output, usage, cached } = await withStage(
    onProgress,
    'extracting',
    async (stage) => {
      const req = { ...extractionRequest(pdf, type), signal };
      if (!onProgress) return llm.call(PROMPT_VERSION, req);
      const stream = throttleOutput((delta) => stage.progress(delta, { ephemeral: true }));
      try {
        return await llm.call(PROMPT_VERSION, req, { onChunk: stream.push });
      } finally {
        // The last delta goes out before the stage ends; a cancelled call drops what is pending instead.
        await (signal?.aborted ? stream.close() : stream.flush());
      }
    },
    (r) => ({ model, documentType: type, cached: r.cached, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens }),
    { model, documentType: type },
  );
  const { data, partial, issues } = await withStage(
    onProgress,
    'normalizing',
    async () => {
      const r = pipeline.normalize(output as never);
      // Required values the model filled in although the invoice leaves them blank (printed.ts).
      if (type === 'COMMERCIAL_INVOICE' && r.data) r.issues.push(...dropUnprintedInvoiceValues(r.data as CommercialInvoice, pdf));
      else if (r.data) {
        // The same for the other documents; a required value dropped makes the document invalid, as a missing one would.
        const dropped = dropUnprintedValues(type, r.data as ExtractedDocument, output, pdf);
        if (dropped.length) {
          r.issues.push(...dropped);
          const again = DOCUMENT_SCHEMAS[type].safeParse(r.data);
          if (!again.success) return { data: null, partial: r.data, issues: [...r.issues, ...again.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)] };
        }
      }
      return r;
    },
    (r) => ({ normalized: r.data !== null, issues: r.issues.length }),
  );
  return { raw: output, data, partial, issues, usage, cached };
}

export interface ExtractOptions {
  /** Stage updates: reading, ocr (scans only), classifying, extracting, normalizing. */
  onProgress?: ProgressCallback<ExtractionDetail>;
  /**
   * Stops the extraction (the user cancelled it): checked between stages and between OCR pages, and
   * passed to the model call. The promise then rejects with the signal's reason, the stage it was in failed.
   */
  signal?: AbortSignal;
}

/** PDF bytes -> classified, extracted and normalized document. `type` skips classification. */
export async function extractDocument(pdfBytes: Uint8Array, llm: LlmClient, type?: ExtractableType, { onProgress, signal }: ExtractOptions = {}): Promise<ExtractionResult> {
  signal?.throwIfAborted();
  const pdf = await withStage(onProgress, 'reading', () => readPdfText(pdfBytes, { onProgress, signal }), (p) => ({ pages: p.pageCount, ...(p.ocrPages ? { ocrPages: p.ocrPages } : {}) }));
  return extractFromPdfText(pdf, llm, type, { onProgress, signal });
}

/**
 * The text of a PDF (or of some of its pages: split.ts) -> classified, extracted and normalized
 * document. `type` skips classification.
 */
export async function extractFromPdfText(pdf: PdfText, llm: LlmClient, type?: ExtractableType, { onProgress, signal }: ExtractOptions = {}): Promise<ExtractionResult> {
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
  signal?.throwIfAborted();
  if (!(detected.type in PIPELINES)) {
    return { documentType: detected.type, typeConfidence: detected.confidence, pdf, raw: null, data: null, issues: [`Unsupported document type ${detected.type}`], cached: false };
  }
  const result = await extractFromText(pdf, detected.type as ExtractableType, llm, onProgress, signal);
  if (pdf.ocrPages) result.issues.unshift(`Read with OCR (page${pdf.ocrPages.length > 1 ? 's' : ''} ${pdf.ocrPages.join(', ')}${pdf.ocrConfidence !== undefined ? `, confidence ${pdf.ocrConfidence}%` : ''}): check values against the scan`);
  return { documentType: detected.type, typeConfidence: detected.confidence, pdf, ...result };
}
