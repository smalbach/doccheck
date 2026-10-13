import { AccountPage } from '../../features/account/AccountPage';
import { AdminOnly } from '../../features/admin/AdminOnly';
import { SettingsPage } from '../../features/admin/settings/SettingsPage';
import { SystemPage } from '../../features/admin/system/SystemPage';
import { UsersPage } from '../../features/admin/users/UsersPage';
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
    case 'admin-settings':
      return (
        <AdminOnly>
          <SettingsPage />
        </AdminOnly>
      );
    case 'admin-users':
      return (
        <AdminOnly>
          <UsersPage />
        </AdminOnly>
      );
    case 'admin-system':
      return (
        <AdminOnly>
          <SystemPage />
        </AdminOnly>
      );
    case 'not-found':
      return <NotFoundPage />;
  }
}
