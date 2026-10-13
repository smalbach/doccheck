import { AccountPage } from '../../features/account/AccountPage';
import { DashboardPage } from '../../features/dashboard/DashboardPage';
import { NotFoundPage } from '../../features/NotFoundPage';
import { ResultsPage } from '../../features/results/ResultsPage';
import { RulesPage } from '../../features/rules/RulesPage';
import { SamplesPage } from '../../features/samples/SamplesPage';
import { ShipmentPage } from '../../features/shipment/ShipmentPage';
import { NewShipmentPage } from '../../features/shipments/NewShipmentPage';
import { ShipmentsPage } from '../../features/shipments/ShipmentsPage';
import type { AppRoute } from '../../lib/parseRoute';

/** The page of an app route (inside the sidebar layout). */
export function RouteView({ route }: { route: AppRoute }) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'shipments':
      return <ShipmentsPage />;
    case 'new-shipment':
      return <NewShipmentPage />;
    case 'shipment':
      return <ShipmentPage id={route.id} />;
    case 'samples':
      return <SamplesPage />;
    case 'rules':
      return <RulesPage />;
    case 'results':
      return <ResultsPage />;
    case 'account':
      return <AccountPage />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
