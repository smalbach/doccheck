import { lazy } from 'react';
import { AdminOnly } from '../../features/admin/AdminOnly';
import { DashboardPage } from '../../features/dashboard/DashboardPage';
import { NotFoundPage } from '../../features/NotFoundPage';
import { SamplesPage } from '../../features/samples/SamplesPage';
import { ShipmentPage } from '../../features/shipment/ShipmentPage';
import { NewShipmentPage } from '../../features/shipments/NewShipmentPage';
import { ShipmentsPage } from '../../features/shipments/ShipmentsPage';
import type { AppRoute } from '../../lib/parseRoute';

// Pages most visits never open load on demand, so the first load stays small.
const AccountPage = lazy(() => import('../../features/account/AccountPage').then((m) => ({ default: m.AccountPage })));
const SettingsPage = lazy(() => import('../../features/admin/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SystemPage = lazy(() => import('../../features/admin/system/SystemPage').then((m) => ({ default: m.SystemPage })));
const UsersPage = lazy(() => import('../../features/admin/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const ResultsPage = lazy(() => import('../../features/results/ResultsPage').then((m) => ({ default: m.ResultsPage })));
const RulesPage = lazy(() => import('../../features/rules/RulesPage').then((m) => ({ default: m.RulesPage })));

/** The page component of an app route. */
export function RoutePage({ route }: { route: AppRoute }) {
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
