import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { Sheet } from '../../components/ui/Sheet';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import { HighlightMark } from './HighlightMark';
import { PdfPager } from './PdfPager';
import type { ViewerTarget } from './types';
import { useLiveHighlight } from './useLiveHighlight';
import { usePageRender } from './usePageRender';
import { usePdfDocument } from './usePdfDocument';

export interface PdfViewerSheetProps {
  shipmentId: string;
  target: ViewerTarget;
  onClose: () => void;
  /** The model's answer so far, while the document is being extracted: the value it just read is outlined. */
  liveText?: string;
}

/**
 * One page of a PDF at a time, with the region a finding cites outlined; while the document is being
 * extracted, the line holding the value the model just wrote instead (following it from page to page).
 */
export function PdfViewerSheet({ shipmentId, target, onClose, liveText }: PdfViewerSheetProps) {
  const { t } = useI18n();
  const { doc, highlight } = target;
  const { pdf, error } = usePdfDocument(api.fileUrl(shipmentId, doc.id));
  const [page, setPage] = useState(highlight?.page ?? 1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = usePageRender(pdf, page, canvas);

  const live = useLiveHighlight(pdf, liveText);

  useEffect(() => setPage(highlight?.page ?? 1), [highlight]);
  useEffect(() => {
    if (live) setPage(live.page);
  }, [live]);

  const pages = pdf?.numPages ?? 0;
  const shown = live ?? highlight;
  const bbox = shown?.page === page ? shown.bbox : undefined;

  return (
    <Sheet
      title={`${t(DOCUMENT_TYPE_KEY[doc.detectedType])} · ${doc.fileName}`}
      onClose={onClose}
      actions={<PdfPager page={page} pages={pages} onPageChange={(n) => setPage(Math.min(Math.max(1, n), pages))} />}
    >
      {error ? (
        <p className="error sheet-body">{error}</p>
      ) : (
        <>
          {live && <p className="viewer-live muted small">{t('viewer.reading', { value: live.value })}</p>}
          <div className="pdf-page">
            <canvas ref={canvas} role="img" aria-label={`${doc.fileName}, ${t('viewer.page', { page, pages })}`} />
            {bbox && <HighlightMark bbox={bbox} scale={scale} live={!!live} />}
          </div>
        </>
      )}
    </Sheet>
  );
}
