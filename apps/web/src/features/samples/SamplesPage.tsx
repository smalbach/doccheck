import { api } from '../../api/client';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useOpenShipment } from '../../hooks/useOpenShipment';
import { useSamples } from '../../hooks/useSamples';
import { useI18n } from '../../i18n/useI18n';
import { SamplesCard } from './SamplesCard';

export function SamplesPage() {
  const { t } = useI18n();
  const demo = useDemo();
  const samples = useSamples();
  const { busy, error, open } = useOpenShipment();
  if (!samples) return <LoadingCard />;
  return (
    <div className="page">
      <PageHeader title={t('samples.title')} description={t('samples.description')} />
      {error && <Banner tone="error">{error}</Banner>}
      {samples.length === 0 ? (
        <Card>
          <EmptyState title={t('samples.noneTitle')}>{t('samples.noneText')}</EmptyState>
        </Card>
      ) : (
        <SamplesCard samples={samples} demo={demo} busy={busy} onLoad={(id) => void open(id, () => api.loadSample(id))} />
      )}
    </div>
  );
}
