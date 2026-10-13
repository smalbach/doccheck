/**
 * PDF -> text lines with positions, using pdf.js (pure JS, no system dependency).
 * Lines keep their bounding box so every extracted value can be traced back to a page and a
 * region of it (SourceRef). Scanned PDFs without a text layer return no lines: OCR is a later step.
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

export async function readPdfText(data: Uint8Array): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js takes ownership of the buffer; copy so the caller can reuse theirs.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  const lines: TextLine[] = [];
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        const h = it.height || Math.abs(it.transform[3]);
        items.push({ str: it.str, x: it.transform[4], y: height - it.transform[5] - h, w: it.width, h });
      }
      const pageLines = groupRows(items).map((row) => toLine(p, row));
      lines.push(...pageLines);
      pages.push(pageLines.map((l) => l.text).join('\n'));
    }
  } finally {
    await task.destroy();
  }
  return { pageCount: pages.length, lines, text: pages.map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n\n') };
}

function groupRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) <= ROW_TOLERANCE) row.push(it);
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
