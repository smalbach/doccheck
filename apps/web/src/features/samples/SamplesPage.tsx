import { api } from '../../api/client';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useOpenShipment } from '../../hooks/useOpenShipment';
import { useSamples } from '../../hooks/useSamples';
import { SamplesCard } from './SamplesCard';

export function SamplesPage() {
  const demo = useDemo();
  const samples = useSamples();
  const { busy, error, open } = useOpenShipment();
  if (!samples) return <LoadingCard />;
  return (
    <div className="page">
      <PageHeader title="Samples" description="Synthetic shipments with known, injected errors: a quick way to see what the checks catch." />
      {error && <Banner tone="error">{error}</Banner>}
      {samples.length === 0 ? (
        <Card>
          <EmptyState title="No samples on this server">Generate them with npm run synth.</EmptyState>
        </Card>
      ) : (
        <SamplesCard samples={samples} demo={demo} busy={busy} onLoad={(id) => void open(id, () => api.loadSample(id))} />
      )}
    </div>
  );
}
