import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { ReviewField } from '../../api/review';
import { useI18n } from '../../i18n/useI18n';
import { HighlightMark } from '../pdf/HighlightMark';
import { PdfPager } from '../pdf/PdfPager';
import { usePageRender } from '../pdf/usePageRender';
import { usePdfDocument } from '../pdf/usePdfDocument';

export interface ReviewPdfPaneProps {
  shipmentId: string;
  documentId: string;
  fileName: string;
  field?: ReviewField;
}

/** The document's PDF, on the page of the selected value, with the value outlined. */
export function ReviewPdfPane({ shipmentId, documentId, fileName, field }: ReviewPdfPaneProps) {
  const { t } = useI18n();
  const { pdf, error } = usePdfDocument(api.fileUrl(shipmentId, documentId));
  const source = field?.source;
  const [page, setPage] = useState(source?.page ?? 1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = usePageRender(pdf, page, canvas);
  useEffect(() => {
    if (source) setPage(source.page);
  }, [source]);
  const pages = pdf?.numPages ?? 0;
  const bbox = source?.page === page ? source.bbox : undefined;
  return (
    <section className="card review-pdf">
      <div className="card-head">
        <span className="muted small">{field && !source ? t('reviewQueue.noPdfMark') : fileName}</span>
        <PdfPager page={page} pages={pages} onPageChange={(n) => setPage(Math.min(Math.max(1, n), pages))} />
      </div>
      {error ? (
        <p className="error">{error}</p>
      ) : (
        // Focusable so the page can be scrolled from the keyboard when it is larger than its frame.
        <div className="pdf-page" tabIndex={0} role="region" aria-label={fileName}>
          <canvas ref={canvas} role="img" aria-label={t('reviewQueue.pdfLabel', { name: fileName, page, pages: pages || 1 })} />
          {bbox && <HighlightMark bbox={bbox} scale={scale} />}
        </div>
      )}
    </section>
  );
}
