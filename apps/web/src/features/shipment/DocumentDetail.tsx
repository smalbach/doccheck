import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';

export interface DocumentDetailProps {
  doc: ShipmentDocument;
  onShowData: (doc: ShipmentDocument) => void;
}

/** One line under the file name: its type and pages, the extraction error, or that it is still extracting. */
export function DocumentDetail({ doc, onShowData }: DocumentDetailProps) {
  const { t } = useI18n();
  if (doc.status === 'FAILED') return <span className="error">{doc.error}</span>;
  if (doc.status !== 'EXTRACTED') return <>{t('shipment.extracting')}</>;
  return (
    <>
      {t(DOCUMENT_TYPE_KEY[doc.detectedType])} · {doc.format && doc.format !== 'PDF' ? `${t(`documentFormats.${doc.format}`)} · ` : ''}
      {t('shipment.pages', { count: doc.pageCount })} ·{' '}
      <Button variant="link" size="sm" onClick={() => onShowData(doc)} aria-label={`${t('shipment.extractedData')} · ${doc.fileName}`}>
        {t('shipment.extractedData')}
      </Button>
    </>
  );
}
