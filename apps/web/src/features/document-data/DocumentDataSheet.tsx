import { useState } from 'react';
import type { ShipmentDocument } from '../../api/types';
import { Sheet } from '../../components/ui/Sheet';
import { useI18n } from '../../i18n/useI18n';
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
  const { t } = useI18n();
  const { detail, error: loadError } = useDocumentDetail(shipmentId, doc.id);
  const [actionError, setActionError] = useState<string>();
  const error = actionError ?? (loadError && t('extracted.loadError', { message: loadError }));

  return (
    <Sheet title={t('extracted.title', { file: doc.fileName })} onClose={onClose}>
      <div className="sheet-body">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!detail && !loadError && (
          <p className="muted" role="status">
            {t('common.loading')}
          </p>
        )}
        {detail && (
          <>
            <ExtractionIssues issues={detail.issues} />
            {detail.data ? (
              <>
                <ExtractedFields type={doc.detectedType} data={detail.data} />
                <ExtractedRowsTable type={doc.detectedType} data={detail.data} />
              </>
            ) : (
              <p className="muted">{t('extracted.notNormalized')}</p>
            )}
            {!readOnly && <ReextractControl shipmentId={shipmentId} doc={doc} onDone={onReextracted} onError={setActionError} />}
            <p className="muted small">
              {t('extracted.footer', { model: detail.model ?? '', prompt: detail.promptVersion ?? '' })}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
