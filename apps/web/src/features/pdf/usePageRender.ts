import { useEffect, useState, type RefObject } from 'react';
import type { pdfjs } from './pdfjs';

const MAX_SCALE = 2;

/** Renders one page into the canvas at the width of its container (sharp on high-DPI screens); returns the CSS scale used. */
export function usePageRender(pdf: pdfjs.PDFDocumentProxy | undefined, pageNumber: number, canvas: RefObject<HTMLCanvasElement | null>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    let task: pdfjs.RenderTask | undefined;
    let cancelled = false;
    void (async () => {
      const element = canvas.current;
      if (!pdf || !element) return;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const width = element.parentElement?.clientWidth ?? 800;
      const cssScale = Math.min(MAX_SCALE, width / page.getViewport({ scale: 1 }).width);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: cssScale * ratio });
      element.width = viewport.width;
      element.height = viewport.height;
      element.style.width = `${viewport.width / ratio}px`;
      element.style.height = `${viewport.height / ratio}px`;
      setScale(cssScale);
      task = page.render({ canvas: element, viewport });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, canvas]);
  return scale;
}
