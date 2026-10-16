import type { Validation } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { useI18n } from '../../i18n/useI18n';
import { TariffLineItem } from './TariffLineItem';

/** Per invoice line: declared HS code and its validity, the agent's view, suggested codes and agency flags. */
export function TariffCard({ validation }: { validation?: Validation }) {
  const { t } = useI18n();
  const tariff = validation?.agent?.tariff;
  if (!tariff || tariff.lines.length === 0) return null;
  return (
    <Card title={t('tariff.title')} className="tariff-card">
      <p className="muted small">
        {tariff.schedule ? (
          <span lang="en">{t('tariff.schedule', { schedule: tariff.schedule })}</span>
        ) : (
          t('tariff.noSchedule')
        )}
      </p>
      <p className="muted small">{t('tariff.intro')}</p>
      {tariff.unavailable.length > 0 && <p className="muted small">{t('tariff.unavailable', { rules: tariff.unavailable.join(', ') })}</p>}
      <ul className="tariff-lines">
        {tariff.lines.map((line) => (
          <TariffLineItem key={line.index} line={line} />
        ))}
      </ul>
    </Card>
  );
}
