import type { ShipmentTotals } from '../../lib/summarizeShipments';
import { StatTile } from './StatTile';

export function DashboardStats({ totals }: { totals: ShipmentTotals }) {
  return (
    <div className="stat-tiles">
      <StatTile label="Shipments" value={totals.total} href="#/app/shipments" />
      <StatTile label="In progress" value={totals.inProgress} href="#/app/shipments" hint="Not validated yet" />
      <StatTile label="Need attention" value={totals.attention} href="#/app/shipments" tone={totals.attention ? 'attention' : 'neutral'} hint={`${totals.findings} open findings`} />
      <StatTile label="Clean" value={totals.clean} href="#/app/shipments" tone="ok" hint="Validated, nothing found" />
    </div>
  );
}
