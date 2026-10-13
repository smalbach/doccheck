import { PlusIcon } from '@radix-ui/react-icons';
import { useMemo, useState } from 'react';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { filterShipments, type ShipmentFilterState } from '../../lib/filterShipments';
import { pluralize } from '../../lib/pluralize';
import { ShipmentFilters } from './ShipmentFilters';
import { ShipmentsTable } from './ShipmentsTable';

export function ShipmentsPage() {
  const demo = useDemo();
  const { shipments, error } = useShipmentList();
  const [filters, setFilters] = useState<ShipmentFilterState>({ status: 'all', destination: 'any', query: '' });
  const shown = useMemo(() => filterShipments(shipments ?? [], filters), [shipments, filters]);

  const actions = !demo && (
    <Button asChild variant="primary">
      <a href="#/app/shipments/new">
        <PlusIcon aria-hidden /> New shipment
      </a>
    </Button>
  );
  if (!shipments) return <LoadingCard error={error} />;
  return (
    <div className="page">
      <PageHeader title="Shipments" description={`${pluralize(shipments.length, 'shipment')} in your workspace.`} actions={actions} />
      <Card>
        {shipments.length === 0 ? (
          <EmptyState
            title="No shipments yet"
            action={
              <Button asChild>
                <a href="#/app/samples">Try a sample</a>
              </Button>
            }
          >
            {demo ? 'Open one of the samples to see how a check works.' : 'Create one and upload its PDFs, or start from a synthetic sample.'}
          </EmptyState>
        ) : (
          <>
            <ShipmentFilters value={filters} onChange={setFilters} />
            {shown.length === 0 ? <EmptyState title="Nothing matches these filters" /> : <ShipmentsTable shipments={shown} />}
          </>
        )}
      </Card>
    </div>
  );
}
