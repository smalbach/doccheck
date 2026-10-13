import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../auth/useAuth';
import { ShipmentsTable } from '../shipments/ShipmentsTable';
import { AlertsCard } from './AlertsCard';
import { DashboardStats } from './DashboardStats';
import { DemoNote } from './DemoNote';
import { QuickActions } from './QuickActions';

const RECENT = 5;

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const demo = useDemo();
  const { page, error } = useShipmentList({ limit: RECENT });
  if (!page) return <LoadingCard error={error} />;

  const firstName = user?.name.split(/\s+/)[0] ?? '';
  return (
    <div className="page">
      <PageHeader title={t('dashboard.hello', { name: firstName })} description={t('dashboard.subtitle')} />
      {demo && <DemoNote />}
      <DashboardStats totals={page.summary} />
      <AlertsCard />
      <QuickActions demo={demo} />
      <Card
        title={t('dashboard.recent')}
        aside={
          page.total > RECENT && (
            <Button asChild variant="link" size="sm">
              <a href="#/app/shipments">{t('dashboard.viewAll')}</a>
            </Button>
          )
        }
      >
        {page.items.length === 0 ? (
          <EmptyState title={t('dashboard.emptyTitle')}>{t('dashboard.emptyText')}</EmptyState>
        ) : (
          <ShipmentsTable shipments={page.items} />
        )}
      </Card>
    </div>
  );
}
