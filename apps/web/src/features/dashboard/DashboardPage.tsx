import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { summarizeShipments } from '../../lib/summarizeShipments';
import { useAuth } from '../auth/useAuth';
import { ShipmentsTable } from '../shipments/ShipmentsTable';
import { DashboardStats } from './DashboardStats';
import { DemoNote } from './DemoNote';
import { QuickActions } from './QuickActions';

const RECENT = 5;

export function DashboardPage() {
  const { user } = useAuth();
  const demo = useDemo();
  const { shipments, error } = useShipmentList();
  if (!shipments) return <LoadingCard error={error} />;

  const firstName = user?.name.split(/\s+/)[0] ?? '';
  return (
    <div className="page">
      <PageHeader title={`Hello, ${firstName}`} description="Your shipments at a glance." />
      {demo && <DemoNote />}
      <DashboardStats totals={summarizeShipments(shipments)} />
      <QuickActions demo={demo} />
      <Card
        title="Recent shipments"
        aside={
          shipments.length > RECENT && (
            <Button asChild variant="link" size="sm">
              <a href="#/app/shipments">View all</a>
            </Button>
          )
        }
      >
        {shipments.length === 0 ? <EmptyState title="No shipments yet">Start with a sample or create a shipment.</EmptyState> : <ShipmentsTable shipments={shipments.slice(0, RECENT)} />}
      </Card>
    </div>
  );
}
