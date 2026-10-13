import { useI18n } from '../../i18n/useI18n';

export function BackLink() {
  const { t } = useI18n();
  return (
    <a href="#/app/shipments" className="back-link">
      {t('app.backToShipments')}
    </a>
  );
}
