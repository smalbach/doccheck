import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { Sheet } from '../../components/ui/Sheet';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';
import { HighlightMark } from './HighlightMark';
import { PdfPager } from './PdfPager';
import type { ViewerTarget } from './types';
import { usePageRender } from './usePageRender';
import { usePdfDocument } from './usePdfDocument';

export interface PdfViewerSheetProps {
  shipmentId: string;
  target: ViewerTarget;
  onClose: () => void;
}

/** One page of a PDF at a time, with the region a finding cites outlined. */
export function PdfViewerSheet({ shipmentId, target, onClose }: PdfViewerSheetProps) {
  const { doc, highlight } = target;
  const { pdf, error } = usePdfDocument(api.fileUrl(shipmentId, doc.id));
  const [page, setPage] = useState(highlight?.page ?? 1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = usePageRender(pdf, page, canvas);

  useEffect(() => setPage(highlight?.page ?? 1), [highlight]);

  const pages = pdf?.numPages ?? 0;
  const bbox = highlight?.page === page ? highlight.bbox : undefined;

  return (
    <Sheet
      title={`${DOCUMENT_TYPE_LABEL[doc.detectedType]} · ${doc.fileName}`}
      onClose={onClose}
      actions={<PdfPager page={page} pages={pages} onPageChange={(n) => setPage(Math.min(Math.max(1, n), pages))} />}
    >
      {error ? (
        <p className="error sheet-body">{error}</p>
      ) : (
        <div className="pdf-page">
          <canvas ref={canvas} />
          {bbox && <HighlightMark bbox={bbox} scale={scale} />}
        </div>
      )}
    </Sheet>
  );
}
