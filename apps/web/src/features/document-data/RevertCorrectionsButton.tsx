import { useState } from 'react';
import { api } from '../../api/client';
import type { DocumentDetail } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface RevertCorrectionsButtonProps {
  shipmentId: string;
  documentId: string;
  onReverted: (detail: DocumentDetail) => void;
  onError: (message: string) => void;
}

/** Puts back every value the model read, after confirming. */
export function RevertCorrectionsButton({ shipmentId, documentId, onReverted, onError }: RevertCorrectionsButtonProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const revert = async () => {
    setBusy(true);
    try {
      onReverted(await api.revertData(shipmentId, documentId));
    } catch (e) {
      onError(t('extracted.revertError', { message: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      trigger={<Button disabled={busy}>{busy ? t('extracted.reverting') : t('extracted.revert')}</Button>}
      title={t('extracted.revertTitle')}
      description={t('extracted.revertText')}
      confirmLabel={t('extracted.revertConfirm')}
      onConfirm={() => void revert()}
    />
  );
}
