import type { DocumentType } from '@doccheck/schemas';
import { classifyDocument } from './classify';
import type { PdfText } from './pdf-text';

/**
 * One uploaded PDF that holds several documents (a scan of the whole folder, a forwarder's pack):
 * each page is classified on its own, and a new document starts where a page announces one. Every
 * part keeps the page numbers of the upload, so evidence cites the page as it is in that PDF.
 */

export interface PageClass {
  page: number;
  type: DocumentType;
  confidence: number;
  /** The page's first lines carry the type's title (the page can start a document). */
  titled: boolean;
  /** "Page 2 of 3" printed on the page: [2, 3]. */
  marker?: [number, number];
}

export interface Segment {
  type: DocumentType;
  confidence: number;
  pages: number[];
}

const MARKER = /\b(?:page|pg\.?|p\.|seite|página|pagina)\s*(\d{1,3})\s*(?:of|\/|de|von|sur)\s*(\d{1,3})\b/i;
/** Below this, a page's type is a guess: it joins the document before it rather than start one. */
const MIN_CONFIDENCE = 0.5;

/** The text of each page, in reading order. */
function pageTexts(pdf: PdfText): string[] {
  const pages: string[][] = Array.from({ length: pdf.pageCount }, () => []);
  for (const l of pdf.lines) pages[l.page - 1]?.push(l.text);
  return pages.map((p) => p.join('\n'));
}

export function classifyPages(pdf: PdfText): PageClass[] {
  return pageTexts(pdf).map((text, i) => {
    const { type, confidence } = classifyDocument(text);
    const head = classifyDocument(text.split('\n').slice(0, 8).join('\n'));
    const marker = text.match(MARKER);
    return {
      page: i + 1,
      type,
      confidence,
      titled: head.type === type && head.confidence > 0 && type !== 'UNKNOWN',
      ...(marker ? { marker: [Number(marker[1]), Number(marker[2])] as [number, number] } : {}),
    };
  });
}

/**
 * Pages grouped into documents. A page starts a new document when it is titled as another type than
 * the document so far, or when its page marker restarts at 1; untitled, unreadable or uncertain pages
 * continue the document before them. A marker numbering the whole upload ("Page 4 of 7" on page 4 of
 * a 7-page PDF) says nothing about where documents start and is ignored.
 */
export function splitDocuments(pdf: PdfText): Segment[] {
  const pages = classifyPages(pdf);
  const global = pages.filter((p) => p.marker).every((p) => p.marker![0] === p.page && p.marker![1] === pdf.pageCount);
  const segments: Segment[] = [];
  for (const p of pages) {
    const current = segments[segments.length - 1];
    const marker = global ? undefined : p.marker;
    const sure = p.type !== 'UNKNOWN' && p.confidence >= MIN_CONFIDENCE;
    const restarts = !!marker && marker[0] === 1;
    if (!current || (sure && (marker ? restarts : p.titled && p.type !== current.type && current.type !== 'UNKNOWN'))) {
      segments.push({ type: sure ? p.type : 'UNKNOWN', confidence: sure ? p.confidence : 0, pages: [p.page] });
    } else {
      // An unreadable first page takes the type of the first page that is sure of one.
      if (current.type === 'UNKNOWN' && sure) Object.assign(current, { type: p.type, confidence: p.confidence });
      current.pages.push(p.page);
    }
  }
  return segments;
}

/** The part of a PDF's text on the given pages, numbered as in the whole PDF. */
export function pdfPages(pdf: PdfText, pages: readonly number[]): PdfText {
  const keep = new Set(pages);
  const lines = pdf.lines.filter((l) => keep.has(l.page));
  const text = [...keep]
    .sort((a, b) => a - b)
    .map((p) => `--- ${lines.find((l) => l.page === p)?.sheet !== undefined ? `sheet ${p}: ${lines.find((l) => l.page === p)!.sheet}` : `page ${p}`} ---\n${lines.filter((l) => l.page === p).map((l) => l.text).join('\n')}`)
    .join('\n\n');
  const ocrPages = pdf.ocrPages?.filter((p) => keep.has(p));
  return { pageCount: pdf.pageCount, lines, text, ...(ocrPages?.length ? { ocrPages, ocrConfidence: pdf.ocrConfidence } : {}) };
}
