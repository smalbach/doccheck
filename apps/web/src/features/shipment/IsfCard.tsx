import { useRef } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { errorMessage } from '../../lib/errorMessage';
import { useI18n } from '../../i18n/useI18n';
import { IsfSource } from './IsfSource';
import { useIsf } from './useIsf';

export interface IsfCardProps {
  shipmentId: string;
  /** Changes when an ISF PDF finishes extracting, to reload. */
  version: string;
  readOnly: boolean;
  onError: (message: string) => void;
  onOpen: (documentId: string) => void;
}

/** The shipment's ISF: from its filing confirmation PDF (dropped with the other documents), from JSON (the Isf schema), or from the sample. */
export function IsfCard({ shipmentId, version, readOnly, onError, onOpen }: IsfCardProps) {
  const { t, formatDateTime } = useI18n();
  const [isf, setIsf] = useIsf(shipmentId, version);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      setIsf(await api.saveIsf(shipmentId, JSON.parse(await file.text())));
    } catch (e) {
      onError(e instanceof SyntaxError ? t('shipment.isf.invalidJson', { file: file.name }) : t('shipment.isf.rejected', { message: errorMessage(e) }));
    }
  };
  const remove = async () => {
    try {
      await api.deleteIsf(shipmentId);
      setIsf(null);
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  if (isf === undefined) return null;
  return (
    <div className="isf">
      <h3>{t('shipment.isf.title')}</h3>
      {isf ? (
        <p className="small">
          {t('shipment.isf.summary', { seller: isf.data.seller.name, origin: isf.data.countryOfOrigin, hts: isf.data.htsCode })}
          <br />
          <span className="muted">
            <IsfSource isf={isf} onOpen={onOpen} /> {formatDateTime(isf.updatedAt)}
            {!readOnly && (
              <>
                {' · '}
                <Button variant="link" size="sm" onClick={() => void remove()}>
                  {t('shipment.isf.remove')}
                </Button>
              </>
            )}
          </span>
        </p>
      ) : (
        <p className="small muted">
          {t('shipment.isf.none')}
          {!readOnly && (
            <>
              {' '}
              {t('shipment.isf.dropOr')}{' '}
              <Button variant="link" size="sm" onClick={() => input.current?.click()}>
                {t('shipment.isf.uploadJson')}
              </Button>
            </>
          )}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
