import type { IsfFiling } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';

export function IsfSource({ isf, onOpen }: { isf: IsfFiling; onOpen: (documentId: string) => void }) {
  const { t } = useI18n();
  if (isf.source === 'pdf' && isf.documentId) {
    const documentId = isf.documentId;
    return (
      <>
        {t('shipment.isf.fromPdf')}{' '}
        <Button variant="link" size="sm" onClick={() => onOpen(documentId)}>
          {isf.fileName ?? t('shipment.isf.document')}
        </Button>
      </>
    );
  }
  return <>{isf.source === 'sample' ? t('shipment.isf.fromSample') : t('shipment.isf.fromJson')}</>;
}
