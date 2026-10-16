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
const InboxPage = lazy(() => import('../../features/mail/InboxPage').then((m) => ({ default: m.InboxPage })));
const ThreadPage = lazy(() => import('../../features/mail/ThreadPage').then((m) => ({ default: m.ThreadPage })));
// The data pages share one chunk.
const data = () => import('../../features/insights/pages');
const DataSummaryPage = lazy(() => data().then((m) => ({ default: m.DataSummaryPage })));
const GoodsPage = lazy(() => data().then((m) => ({ default: m.GoodsPage })));
const CompaniesPage = lazy(() => data().then((m) => ({ default: m.CompaniesPage })));
const CompanyPage = lazy(() => data().then((m) => ({ default: m.CompanyPage })));
const ProductsPage = lazy(() => data().then((m) => ({ default: m.ProductsPage })));
const ProductPage = lazy(() => data().then((m) => ({ default: m.ProductPage })));
const ContainersPage = lazy(() => data().then((m) => ({ default: m.ContainersPage })));
const DataShipmentsPage = lazy(() => data().then((m) => ({ default: m.DataShipmentsPage })));
const ResultsPage = lazy(() => import('../../features/results/ResultsPage').then((m) => ({ default: m.ResultsPage })));
// Review queue, usage and plans share one chunk.
const more = () => import('../../features/review/pages');
const ReviewQueuePage = lazy(() => more().then((m) => ({ default: m.ReviewQueuePage })));
const ReviewDocumentPage = lazy(() => more().then((m) => ({ default: m.ReviewDocumentPage })));
const UsagePage = lazy(() => more().then((m) => ({ default: m.UsagePage })));
const PlansPage = lazy(() => more().then((m) => ({ default: m.PlansPage })));
// Team pages share one chunk.
const team = () => import('../../features/team/pages');
const TeamPage = lazy(() => team().then((m) => ({ default: m.TeamPage })));
const AuditPage = lazy(() => team().then((m) => ({ default: m.AuditPage })));
const ApprovalsPage = lazy(() => team().then((m) => ({ default: m.ApprovalsPage })));
const NotificationsPage = lazy(() => team().then((m) => ({ default: m.NotificationsPage })));
const RulesPage = lazy(() => import('../../features/rules/RulesPage').then((m) => ({ default: m.RulesPage })));
const RuleSettingsPage = lazy(() => import('../../features/rules/RuleSettingsPage').then((m) => ({ default: m.RuleSettingsPage })));

/** The page component of an app route. */
export function RoutePage({ route }: { route: AppRoute }) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'shipments':
      return <ShipmentsPage due={route.due} assignee={route.assignee} />;
    case 'new-shipment':
      return <NewShipmentPage />;
    case 'shipment':
      return <ShipmentPage id={route.id} />;
    case 'samples':
      return <SamplesPage />;
    case 'inbox':
      return <InboxPage key={route.filter ?? ''} initialFilter={route.filter} />;
    case 'thread':
      return <ThreadPage key={route.id} id={route.id} />;
    case 'data-summary':
      return <DataSummaryPage />;
    case 'goods':
      return <GoodsPage key={`${route.q}:${route.origin}:${route.hs}`} initial={{ query: route.q ?? '', origin: route.origin ?? '', hs: route.hs ?? '' }} />;
    case 'companies':
      return <CompaniesPage />;
    case 'company':
      return <CompanyPage key={route.id} id={route.id} />;
    case 'products':
      return <ProductsPage />;
    case 'product':
      return <ProductPage key={route.id} id={route.id} />;
    case 'containers':
      return <ContainersPage />;
    case 'data-shipments':
      return <DataShipmentsPage />;
    case 'rules':
      return <RulesPage />;
    case 'rule-settings':
      return <RuleSettingsPage />;
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
    case 'review-queue':
      return <ReviewQueuePage />;
    case 'review-document':
      return <ReviewDocumentPage key={route.id} id={route.id} />;
    case 'usage':
      return <UsagePage checkout={route.checkout} />;
    case 'admin-plans':
      return (
        <AdminOnly>
          <PlansPage />
        </AdminOnly>
      );
    case 'team':
      return <TeamPage />;
    case 'audit':
      return <AuditPage />;
    case 'approvals':
      return <ApprovalsPage />;
    case 'notifications':
      return <NotificationsPage />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
