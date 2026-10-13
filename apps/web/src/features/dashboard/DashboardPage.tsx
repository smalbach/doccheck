import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { useI18n } from '../../i18n/useI18n';
import { summarizeShipments } from '../../lib/summarizeShipments';
import { useAuth } from '../auth/useAuth';
import { ShipmentsTable } from '../shipments/ShipmentsTable';
import { DashboardStats } from './DashboardStats';
import { DemoNote } from './DemoNote';
import { QuickActions } from './QuickActions';

const RECENT = 5;

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const demo = useDemo();
  const { shipments, error } = useShipmentList();
  if (!shipments) return <LoadingCard error={error} />;

  const firstName = user?.name.split(/\s+/)[0] ?? '';
  return (
    <div className="page">
      <PageHeader title={t('dashboard.hello', { name: firstName })} description={t('dashboard.subtitle')} />
      {demo && <DemoNote />}
      <DashboardStats totals={summarizeShipments(shipments)} />
      <QuickActions demo={demo} />
      <Card
        title={t('dashboard.recent')}
        aside={
          shipments.length > RECENT && (
            <Button asChild variant="link" size="sm">
              <a href="#/app/shipments">{t('dashboard.viewAll')}</a>
            </Button>
          )
        }
      >
        {shipments.length === 0 ? (
          <EmptyState title={t('dashboard.emptyTitle')}>{t('dashboard.emptyText')}</EmptyState>
        ) : (
          <ShipmentsTable shipments={shipments.slice(0, RECENT)} />
        )}
      </Card>
    </div>
  );
}
