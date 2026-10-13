import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { useDemo } from '../../hooks/useDemo';
import { DemoNote } from './DemoNote';
import { NewShipmentCard } from './NewShipmentCard';
import { RecentShipmentsCard } from './RecentShipmentsCard';
import { SamplesCard } from './SamplesCard';
import { useHomeData } from './useHomeData';
import { useOpenShipment } from './useOpenShipment';

const CREATE = 'create';

export function HomePage() {
  const demo = useDemo();
  const { shipments, samples, error: loadError } = useHomeData();
  const { busy, error, open } = useOpenShipment();
  const shownError = error ?? loadError;

  return (
    <div className="page home">
      {shownError && <Banner tone="error">{shownError}</Banner>}
      {demo ? (
        <DemoNote />
      ) : (
        <NewShipmentCard busy={busy === CREATE} disabled={busy !== undefined} onCreate={(input) => void open(CREATE, () => api.create(input))} />
      )}
      {samples.length > 0 && <SamplesCard samples={samples} demo={demo} busy={busy} onLoad={(id) => void open(id, () => api.loadSample(id))} />}
      <RecentShipmentsCard shipments={shipments} />
    </div>
  );
}
