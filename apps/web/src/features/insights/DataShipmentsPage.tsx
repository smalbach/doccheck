import { DataPage } from './DataPage';
import { ShipmentDataPanel } from './ShipmentDataPanel';

export function DataShipmentsPage() {
  return (
    <DataPage titleKey="insights.pages.shipments.title" descriptionKey="insights.pages.shipments.description">
      {(destination) => <ShipmentDataPanel destination={destination} />}
    </DataPage>
  );
}
