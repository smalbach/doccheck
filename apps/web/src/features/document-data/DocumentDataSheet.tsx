import { useMemo, useState } from 'react';
import type { DocumentDetail, ShipmentDocument } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';
import { CorrectionForm } from './CorrectionForm';
import { ExtractedFields } from './ExtractedFields';
import { ExtractedRowsTable } from './ExtractedRowsTable';
import { ExtractionIssues } from './ExtractionIssues';
import { ReextractControl } from './ReextractControl';
import { RevertCorrectionsButton } from './RevertCorrectionsButton';
import { useDocumentDetail } from './useDocumentDetail';

export interface DocumentDataSheetProps {
  shipmentId: string;
  doc: ShipmentDocument;
  readOnly: boolean;
  /** Opened from a finding: start in edit mode on this field (a JSON pointer, or a parent of one). */
  focus?: string;
  onClose: () => void;
  onReextracted: () => void;
  /** Values were corrected or reverted: the shipment needs validating again. */
  onCorrected: () => void;
}

/** What the extraction read from one document: issues first, then the key fields and the rows; values can be corrected by hand. */
export function DocumentDataSheet({ shipmentId, doc, focus, readOnly, onClose, onReextracted, onCorrected }: DocumentDataSheetProps) {
  const { t } = useI18n();
  const { detail, setDetail, error: loadError } = useDocumentDetail(shipmentId, doc.id);
  const [actionError, setActionError] = useState<string>();
  const [editing, setEditing] = useState(!!focus && !readOnly);
  const [notice, setNotice] = useState<MessageKey>();
  const error = actionError ?? (loadError && t('extracted.loadError', { message: loadError }));
  const corrected = useMemo(() => new Map((detail?.corrected ?? []).map((c) => [c.path, c.modelValue])), [detail]);

  const changed = (next: DocumentDetail, message: MessageKey) => {
    setDetail(next);
    setEditing(false);
    setActionError(undefined);
    setNotice(message);
    onCorrected();
  };

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
            {notice && <Banner tone="ok">{t(notice)}</Banner>}
            <ExtractionIssues issues={detail.issues} />
            {detail.data && editing && (
              <CorrectionForm
                shipmentId={shipmentId}
                documentId={doc.id}
                type={doc.detectedType}
                data={detail.data}
                corrected={corrected}
                focus={focus}
                onSaved={(next) => changed(next, 'extracted.saved')}
                onCancel={() => setEditing(false)}
              />
            )}
            {detail.data && !editing && (
              <>
                {!readOnly && (
                  <div className="correction-actions">
                    <Button
                      onClick={() => {
                        setNotice(undefined);
                        setEditing(true);
                      }}
                    >
                      {t('extracted.edit')}
                    </Button>
                    {corrected.size > 0 && <RevertCorrectionsButton shipmentId={shipmentId} documentId={doc.id} onReverted={(next) => changed(next, 'extracted.reverted')} onError={setActionError} />}
                    {corrected.size > 0 && <span className="muted small">{t('extracted.correctedCount', { count: corrected.size })}</span>}
                  </div>
                )}
                <ExtractedFields type={doc.detectedType} data={detail.data} corrected={corrected} />
                <ExtractedRowsTable type={doc.detectedType} data={detail.data} corrected={corrected} />
              </>
            )}
            {!detail.data && <p className="muted">{t('extracted.notNormalized')}</p>}
            {!readOnly && !editing && corrected.size > 0 && <p className="muted small">{t('extracted.reextractDrops')}</p>}
            {!readOnly && !editing && <ReextractControl shipmentId={shipmentId} doc={doc} onDone={onReextracted} onError={setActionError} />}
            <p className="muted small">
              {t('extracted.footer', { model: detail.model ?? '', prompt: detail.promptVersion ?? '' })}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
