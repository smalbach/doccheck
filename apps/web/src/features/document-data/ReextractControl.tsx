import { useState } from 'react';
import { api } from '../../api/client';
import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { EXTRACTABLE_TYPES, type ExtractableType } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface ReextractControlProps {
  shipmentId: string;
  doc: ShipmentDocument;
  onDone: () => void;
  onError: (message: string) => void;
}

/** For a document the classifier got wrong: extract it again as another type. */
export function ReextractControl({ shipmentId, doc, onDone, onError }: ReextractControlProps) {
  const { t } = useI18n();
  const initial = doc.detectedType === 'UNKNOWN' ? 'COMMERCIAL_INVOICE' : doc.detectedType;
  const [type, setType] = useState<ExtractableType>(initial);
  const [busy, setBusy] = useState(false);

  const reextract = async () => {
    setBusy(true);
    try {
      await api.reextract(shipmentId, doc.id, type);
      onDone();
    } catch (e) {
      onError(t('extracted.refused', { message: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reextract">
      <span className="small muted">{t('extracted.wrongType')}</span>
      <Select value={type} options={EXTRACTABLE_TYPES.map((o) => ({ value: o.value, label: t(o.labelKey) }))} onValueChange={setType} ariaLabel={t('extracted.typeLabel')} />
      <Button onClick={() => void reextract()} disabled={busy || type === doc.detectedType}>
        {busy ? t('extracted.reextracting') : t('extracted.reextract')}
      </Button>
    </div>
  );
}
