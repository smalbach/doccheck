import { useEffect, useMemo, useRef, useState } from 'react';
import { lastCompletedValue } from '../../lib/liveOutput';
import { findValue, groupLines, type PageLine, type TextRun } from '../../lib/pdfTextLines';
import type { pdfjs } from './pdfjs';
import type { Highlight } from './types';

/** The text lines of every page (pdf.js text content), read once per document. undefined while loading or without a PDF. */
function usePdfLines(pdf: pdfjs.PDFDocumentProxy | undefined): PageLine[] | undefined {
  const [lines, setLines] = useState<PageLine[]>();
  useEffect(() => {
    let active = true;
    setLines(undefined);
    if (!pdf) return undefined;
    void (async () => {
      const all: PageLine[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const runs: TextRun[] = content.items.flatMap((item) =>
          'str' in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height || Math.abs(item.transform[3]) }] : [],
        );
        const [, y0 = 0, , y1 = 0] = page.view;
        all.push(...groupLines(runs, n, y1 - y0));
      }
      if (active) setLines(all);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pdf]);
  return lines;
}

/**
 * While the model writes its answer (`text`), where the value it just finished is printed: the latest
 * completed string value matched against the page lines, searching on from the previous match (the model
 * mostly follows the reading order). undefined when nothing is streaming or the value is not found as is
 * (values are copied as printed, so most are).
 */
export function useLiveHighlight(pdf: pdfjs.PDFDocumentProxy | undefined, text: string | undefined): (Highlight & { value: string }) | undefined {
  const lines = usePdfLines(text === undefined ? undefined : pdf);
  const value = useMemo(() => (text === undefined ? undefined : lastCompletedValue(text)), [text]);
  const last = useRef(0);
  return useMemo(() => {
    if (!lines || !value) return undefined;
    const found = findValue(lines, value, last.current);
    if (!found) return undefined;
    last.current = found.index;
    return { page: found.page, bbox: found.bbox, value };
  }, [lines, value]);
}
