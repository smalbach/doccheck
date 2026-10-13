import { queryString } from '../../api/queryString';
import { DataPage } from './DataPage';
import { SummaryPanel } from './SummaryPanel';

/** Totals over every shipment's documents; a row of a breakdown opens the goods filtered on it. */
export function DataSummaryPage() {
  return (
    <DataPage titleKey="insights.pages.summary.title" descriptionKey="insights.pages.summary.description">
      {(destination) => <SummaryPanel destination={destination} onShowGoods={(filter) => (window.location.hash = `#/app/goods${queryString(filter)}`)} />}
    </DataPage>
  );
}
