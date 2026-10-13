import { ContainersPanel } from './ContainersPanel';
import { DataPage } from './DataPage';

/** Every container on the bills of lading, with its B/L, carrier, vessel and route. */
export function ContainersPage() {
  return (
    <DataPage titleKey="insights.pages.containers.title" descriptionKey="insights.pages.containers.description">
      {(destination) => <ContainersPanel destination={destination} />}
    </DataPage>
  );
}
