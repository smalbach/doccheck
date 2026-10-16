import { withStage, type DocumentFormat } from '@doccheck/schemas';
import { extractFromPdfText, type ExtractableType, type ExtractionResult, type ExtractOptions } from './extract';
import { imageFormat } from './image';
import type { LlmClient } from './llm';
import { readPdfText, type PdfText } from './pdf-text';
import { pdfPages, splitDocuments, type Segment } from './split';
import { readSpreadsheet, sheetsToText, spreadsheetFormat, storedSpreadsheetFormat, type Sheet } from './spreadsheet';
import { extractSheets } from './spreadsheet-extract';

/**
 * What can be uploaded, and how each kind reaches the extraction: a PDF as it is, a photo through
 * image.ts (stored as an image-only PDF, so it goes the scan path), a spreadsheet as its grid.
 */
export function inputFormat(fileName: string, bytes: Uint8Array): DocumentFormat | undefined {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'PDF';
  if (imageFormat(fileName, bytes)) return 'IMAGE';
  if (spreadsheetFormat(fileName, bytes)) return 'SPREADSHEET';
  return undefined;
}

/** A stored document read once: its text (a spreadsheet's laid out per sheet) and, for a spreadsheet, the grid. */
export interface StoredDocument {
  pdf: PdfText;
  sheets?: Sheet[];
}

/** Reads a stored file: a PDF (an uploaded photo is stored as one) or a spreadsheet. Stage `reading`. */
export async function readStoredDocument(bytes: Uint8Array, format: DocumentFormat, fileName: string, { onProgress, signal }: ExtractOptions = {}): Promise<StoredDocument> {
  if (format === 'SPREADSHEET') {
    const sheets = readSpreadsheet(bytes, fileName, storedSpreadsheetFormat(bytes));
    return { pdf: sheetsToText(sheets), sheets };
  }
  const pdf = await withStage(onProgress, 'reading', () => readPdfText(bytes, { onProgress, signal }), (p) => ({ pages: p.pageCount, ...(p.ocrPages ? { ocrPages: p.ocrPages } : {}) }));
  return { pdf };
}

/** The documents a stored file holds: one per segment of pages (PDF) or per sheet with content (spreadsheet). */
export function documentParts(doc: StoredDocument): Segment[] {
  return splitDocuments(doc.pdf);
}

/** Extracts the part of a stored document on `pages` (all of it when absent). `type` skips classification. */
export async function extractPart(doc: StoredDocument, pages: readonly number[] | undefined, llm: LlmClient, type?: ExtractableType, opts: ExtractOptions = {}): Promise<ExtractionResult> {
  if (doc.sheets) {
    return extractSheets(doc.sheets, type, { onProgress: opts.onProgress, llm, pages });
  }
  return extractFromPdfText(pages?.length ? pdfPages(doc.pdf, pages) : doc.pdf, llm, type, opts);
}
