import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useOpenShipment } from '../../hooks/useOpenShipment';
import { NewShipmentCard } from './NewShipmentCard';

export function NewShipmentPage() {
  const demo = useDemo();
  const { busy, error, open } = useOpenShipment();
  return (
    <div className="page page-narrow">
      <PageHeader title="New shipment" description="Pick the destination, then upload the commercial invoice, packing list and bill of lading (and the ISF for the US)." />
      {error && <Banner tone="error">{error}</Banner>}
      {demo ? (
        <Card>
          <p className="muted">The read-only demo does not take uploads. <a href="#/app/samples">Open a sample</a> instead.</p>
        </Card>
      ) : (
        <NewShipmentCard busy={busy === 'create'} disabled={busy !== undefined} onCreate={(input) => void open('create', () => api.create(input))} />
      )}
    </div>
  );
}
