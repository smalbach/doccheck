import type { Evidence, ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/Tag';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import type { ViewerTarget } from '../pdf/types';

export interface EvidenceItemProps {
  evidence: Evidence;
  doc?: ShipmentDocument;
  onOpen: (target: ViewerTarget) => void;
  /** Opens the document's data at this field, to correct it (absent: read only). */
  onCorrect?: (doc: ShipmentDocument, field: string) => void;
}

/** One cited value: which document and field, what it says, and a link to the line in the PDF. */
export function EvidenceItem({ evidence, doc, onOpen, onCorrect }: EvidenceItemProps) {
  const { t } = useI18n();
  const { source } = evidence;
  const docLabel = doc ? t(DOCUMENT_TYPE_KEY[doc.detectedType]) : evidence.documentId;
  return (
    <li>
      <span className="muted">{docLabel}</span> <code>{evidence.field}</code>
      {evidence.value ? (
        <>
          {' = '}
          <strong>{evidence.value}</strong>
        </>
      ) : (
        <em className="muted"> {t('shipment.findings.missing')}</em>
      )}
      {evidence.corrected && (
        <>
          {' '}
          <Tag tone="accent">{t('shipment.findings.corrected')}</Tag>
        </>
      )}
      {doc && source && (
        <Button variant="link" size="sm" className="evidence-link" onClick={() => onOpen({ doc, highlight: { page: source.page, bbox: source.bbox } })}
          aria-label={t('shipment.findings.openPage', { page: source.page, document: docLabel })}
        >
          {t('shipment.findings.page', { page: source.page })} ↗
        </Button>
      )}
      {doc && onCorrect && doc.status === 'EXTRACTED' && (
        <Button variant="link" size="sm" className="evidence-link" title={t('review.correctHint')} onClick={() => onCorrect(doc, evidence.field)}>
          {t('review.correct')}
        </Button>
      )}
    </li>
  );
}
