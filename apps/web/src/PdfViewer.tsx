import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Highlight {
  page: number;
  /** [x0, y0, x1, y1] in PDF points, origin top-left (as stored by the extraction). */
  bbox: [number, number, number, number];
}

/** Renders one page of a PDF and outlines the region a finding cites. */
export function PdfViewer({ url, highlight, onClose, title }: { url: string; highlight?: Highlight; onClose: () => void; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(highlight?.page ?? 1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string>();
  const doc = useRef<pdfjs.PDFDocumentProxy | null>(null);

  useEffect(() => setPage(highlight?.page ?? 1), [highlight]);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (d) => {
        if (cancelled) return;
        doc.current = d;
        setPages(d.numPages);
      },
      (e: Error) => setError(e.message),
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    let render: pdfjs.RenderTask | undefined;
    (async () => {
      if (!doc.current || !canvas.current) return;
      const p = await doc.current.getPage(page);
      const width = canvas.current.parentElement?.clientWidth ?? 800;
      const s = Math.min(2, width / p.getViewport({ scale: 1 }).width);
      const viewport = p.getViewport({ scale: s * window.devicePixelRatio });
      const c = canvas.current;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${viewport.width / window.devicePixelRatio}px`;
      c.style.height = `${viewport.height / window.devicePixelRatio}px`;
      setScale(s);
      render = p.render({ canvas: c, viewport });
      await render.promise.catch(() => undefined);
    })();
    return () => render?.cancel();
  }, [page, pages]);

  const box = highlight && highlight.page === page ? highlight.bbox : undefined;
  return (
    <div className="viewer" role="dialog" aria-label={title}>
      <header>
        <strong>{title}</strong>
        {pages > 1 && (
          <span className="pager">
            <button onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1}>‹</button>
            {page} / {pages}
            <button onClick={() => setPage((n) => Math.min(pages, n + 1))} disabled={page >= pages}>›</button>
          </span>
        )}
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>
      {error ? (
        <p className="error">{error}</p>
      ) : (
        <div className="page">
          <canvas ref={canvas} />
          {box && (
            <div
              className="mark"
              style={{ left: box[0] * scale - 3, top: box[1] * scale - 3, width: (box[2] - box[0]) * scale + 6, height: (box[3] - box[1]) * scale + 6 }}
            />
          )}
        </div>
      )}
    </div>
  );
}
