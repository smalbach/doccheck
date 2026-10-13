import type { Shipment, Validation } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { DESTINATION_OPTION_KEY } from '../../constants/destinations';
import { useI18n } from '../../i18n/useI18n';

export interface ValidationNoticeProps {
  shipment: Shipment;
  validation?: Validation;
  /** The shown run is not the latest one. */
  past: boolean;
  onShowLatest: () => void;
}

/** Says when the findings are from an earlier run, or ran against another destination than the shipment's now. */
export function ValidationNotice({ shipment, validation, past, onShowLatest }: ValidationNoticeProps) {
  const { t, formatDateTime } = useI18n();
  if (!validation) return null;
  const moved = validation.destination && shipment.destination && validation.destination !== shipment.destination;
  return (
    <>
      {past && (
        <Banner tone="info">
          {t('shipment.history.viewing', { date: formatDateTime(validation.createdAt) })}{' '}
          <Button variant="link" size="sm" onClick={onShowLatest}>
            {t('shipment.history.backToLatest')}
          </Button>
        </Banner>
      )}
      {moved && !past && <Banner tone="warning">{t('shipment.history.destinationChanged', { destination: t(DESTINATION_OPTION_KEY[validation.destination!]) })}</Banner>}
    </>
  );
}
