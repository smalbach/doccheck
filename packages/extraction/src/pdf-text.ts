import { startStage, type ExtractionDetail, type ProgressCallback, type StageHandle } from '@doccheck/schemas';
import { ocrPage } from './ocr';

/**
 * PDF -> text lines with positions, using pdf.js (pure JS, no system dependency).
 * Lines keep their bounding box so every extracted value can be traced back to a page and a
 * region of it (SourceRef). Pages without a text layer (scans) go through OCR (tesseract) and come
 * back in the same shape, so extraction, citations and highlighting work the same way.
 */

/** [x0, y0, x1, y1] in PDF points, origin at the top-left of the page. */
export type BBox = [number, number, number, number];

export interface TextLine {
  page: number;
  text: string;
  bbox: BBox;
}

export interface PdfText {
  pageCount: number;
  lines: TextLine[];
  /** Layout-preserving text: one line per row, cells padded to their column so tables stay aligned. */
  text: string;
  /** Pages read with OCR, and tesseract's mean confidence on them (0-100). */
  ocrPages?: number[];
  ocrConfidence?: number;
}

export interface ReadOptions {
  /** auto: OCR pages with no text layer (default); off: never; force: every page. */
  ocr?: 'auto' | 'off' | 'force';
  /** Reports the `ocr` stage (one progress event per page recognized), only when a page needs OCR. */
  onProgress?: ProgressCallback<ExtractionDetail>;
  /** Checked before each page (OCR takes seconds per page): reading stops with the signal's reason. */
  signal?: AbortSignal;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Items closer than this vertically (points) belong to the same row. */
const ROW_TOLERANCE = 2.5;

/** A page with fewer characters than this in its text layer is treated as a scan. */
const MIN_TEXT_CHARS = 20;

export async function readPdfText(data: Uint8Array, opts: ReadOptions = {}): Promise<PdfText> {
  const mode = opts.ocr ?? 'auto';
  const ocrPages: number[] = [];
  const confidences: number[] = [];
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js takes ownership of the buffer; copy so the caller can reuse theirs.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  const lines: TextLine[] = [];
  const pages: string[] = [];
  let ocrStage: StageHandle<ExtractionDetail, 'ocr'> | undefined;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      opts.signal?.throwIfAborted();
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let items: Item[] = [];
      for (const it of content.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        const h = it.height || Math.abs(it.transform[3]);
        items.push({ str: it.str, x: it.transform[4], y: height - it.transform[5] - h, w: it.width, h });
      }
      let tolerance = ROW_TOLERANCE;
      const textChars = items.reduce((n, i) => n + i.str.trim().length, 0);
      if (mode === 'force' || (mode === 'auto' && textChars < MIN_TEXT_CHARS)) {
        ocrStage ??= await startStage(opts.onProgress, 'ocr', { pages: doc.numPages });
        await ocrStage.progress({ page: p, pages: doc.numPages });
        const ocr = await ocrPage(page);
        opts.signal?.throwIfAborted();
        items = ocr.words;
        ocrPages.push(p);
        confidences.push(ocr.confidence);
        // OCR boxes jitter more than a text layer, and a slight skew moves a row's words apart.
        const heights = items.map((i) => i.h).sort((a, b) => a - b);
        tolerance = Math.max(ROW_TOLERANCE, (heights[Math.floor(heights.length / 2)] ?? 8) * 0.45);
      }
      const pageLines = groupRows(items, tolerance).map((row) => toLine(p, row));
      lines.push(...pageLines);
      pages.push(pageLines.map((l) => l.text).join('\n'));
    }
  } catch (err) {
    await ocrStage?.fail(err);
    throw err;
  } finally {
    await task.destroy();
  }
  const text = pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n\n');
  if (ocrPages.length === 0) return { pageCount: pages.length, lines, text };
  const ocrConfidence = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
  await ocrStage?.done({ pages: pages.length, ocrPages: ocrPages.length, confidence: ocrConfidence });
  return { pageCount: pages.length, lines, text, ocrPages, ocrConfidence };
}

function groupRows(items: Item[], tolerance = ROW_TOLERANCE): Item[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) <= tolerance) row.push(it);
    else rows.push([it]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

/** Points per character column in the layout text; close to the average glyph width at 8-10 pt. */
const COLUMN_PT = 4;

function toLine(page: number, row: Item[]): TextLine {
  let text = '';
  let cursor: number | undefined;
  for (const it of row) {
    if (cursor !== undefined) {
      const gap = it.x - cursor;
      const charWidth = Math.max(it.h * 0.5, 1);
      if (gap > charWidth * 1.5) {
        // Separate cell: pad to the item's page column so cells of a multi-line table stay aligned.
        text = text.padEnd(Math.max(Math.round(it.x / COLUMN_PT), text.length + 3), ' ');
      } else if (gap > charWidth * 0.2 && !text.endsWith(' ') && !it.str.startsWith(' ')) {
        text += ' ';
      }
    } else {
      text = ' '.repeat(Math.max(0, Math.round(it.x / COLUMN_PT) - 9));
    }
    text += it.str;
    cursor = it.x + it.w;
  }
  const x0 = Math.min(...row.map((i) => i.x));
  const y0 = Math.min(...row.map((i) => i.y));
  const x1 = Math.max(...row.map((i) => i.x + i.w));
  const y1 = Math.max(...row.map((i) => i.y + i.h));
  const r = (n: number) => Math.round(n * 10) / 10;
  return { page, text: text.replace(/\s+$/, ''), bbox: [r(x0), r(y0), r(x1), r(y1)] };
}
