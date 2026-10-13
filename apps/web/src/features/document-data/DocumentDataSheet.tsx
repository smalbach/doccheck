import { useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { Sheet } from '../../components/ui/Sheet';
import { ExtractedFields } from './ExtractedFields';
import { ExtractedRowsTable } from './ExtractedRowsTable';
import { ExtractionIssues } from './ExtractionIssues';
import { ReextractControl } from './ReextractControl';
import { useDocumentDetail } from './useDocumentDetail';

export interface DocumentDataSheetProps {
  shipmentId: string;
  doc: ShipmentDocument;
  readOnly: boolean;
  onClose: () => void;
  onReextracted: () => void;
}

/** What the extraction read from one document: issues first, then the key fields and the rows. */
export function DocumentDataSheet({ shipmentId, doc, readOnly, onClose, onReextracted }: DocumentDataSheetProps) {
  const { detail, error: loadError } = useDocumentDetail(shipmentId, doc.id);
  const [actionError, setActionError] = useState<string>();
  const error = actionError ?? (loadError && `Could not load the extraction (${loadError}).`);

  return (
    <Sheet title={`Extracted data · ${doc.fileName}`} onClose={onClose}>
      <div className="sheet-body">
        {error && <p className="error">{error}</p>}
        {!detail && !loadError && <p className="muted">Loading…</p>}
        {detail && (
          <>
            <ExtractionIssues issues={detail.issues} />
            {detail.data ? (
              <>
                <ExtractedFields type={doc.detectedType} data={detail.data} />
                <ExtractedRowsTable type={doc.detectedType} data={detail.data} />
              </>
            ) : (
              <p className="muted">The document could not be normalized; see the issues above.</p>
            )}
            {!readOnly && <ReextractControl shipmentId={shipmentId} doc={doc} onDone={onReextracted} onError={setActionError} />}
            <p className="muted small">
              {detail.model} · prompt {detail.promptVersion}. Values were normalized from what is printed (dates to ISO, weights to kg); check them against the PDF.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
