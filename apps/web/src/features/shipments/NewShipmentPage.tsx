import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { UsageNotice } from '../usage/UsageNotice';
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
      {!demo && <UsageNotice />}
      {error && <Banner tone="error">{error}</Banner>}
      {demo ? (
        <Card>
          <p className="muted">
            {t('newShipment.demoText')} <a href="#/app/samples">{t('newShipment.demoLink')}</a>
          </p>
        </Card>
      ) : (
        <NewShipmentCard
          busy={busy === 'create'}
          scanning={busy === 'scan'}
          disabled={busy !== undefined}
          onCreate={(input) => void open('create', () => api.create(input))}
          onScan={(input, pdf) =>
            void open('scan', async () => {
              const shipment = await api.create(input);
              try {
                await api.upload(shipment.id, [pdf]);
              } catch (err) {
                // A refused upload (plan limit, size) leaves no empty shipment behind.
                await api.remove(shipment.id).catch(() => undefined);
                throw err;
              }
              return shipment;
            })
          }
        />
      )}
    </div>
  );
}
