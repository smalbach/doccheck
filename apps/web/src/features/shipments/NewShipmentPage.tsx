import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useOpenShipment } from '../../hooks/useOpenShipment';
import { useI18n } from '../../i18n/useI18n';
import { NewShipmentCard } from './NewShipmentCard';

export function NewShipmentPage() {
  const { t } = useI18n();
  const demo = useDemo();
  const { busy, error, open } = useOpenShipment();
  return (
    <div className="page page-narrow">
      <PageHeader title={t('newShipment.title')} description={t('newShipment.description')} />
      {error && <Banner tone="error">{error}</Banner>}
      {demo ? (
        <Card>
          <p className="muted">
            {t('newShipment.demoText')} <a href="#/app/samples">{t('newShipment.demoLink')}</a>
          </p>
        </Card>
      ) : (
        <NewShipmentCard busy={busy === 'create'} disabled={busy !== undefined} onCreate={(input) => void open('create', () => api.create(input))} />
      )}
    </div>
  );
}
