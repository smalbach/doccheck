import { PlusIcon } from '@radix-ui/react-icons';
import { useMemo, useState } from 'react';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { useI18n } from '../../i18n/useI18n';
import { filterShipments, type ShipmentFilterState } from '../../lib/filterShipments';
import { ShipmentFilters } from './ShipmentFilters';
import { ShipmentsTable } from './ShipmentsTable';

export function ShipmentsPage() {
  const { t } = useI18n();
  const demo = useDemo();
  const { shipments, error } = useShipmentList();
  const [filters, setFilters] = useState<ShipmentFilterState>({ status: 'all', destination: 'any', query: '' });
  const shown = useMemo(() => filterShipments(shipments ?? [], filters), [shipments, filters]);

  if (!shipments) return <LoadingCard error={error} />;
  const actions = !demo && (
    <Button asChild variant="primary">
      <a href="#/app/shipments/new">
        <PlusIcon aria-hidden /> {t('shipments.new')}
      </a>
    </Button>
  );
  return (
    <div className="page">
      <PageHeader title={t('shipments.title')} description={t('shipments.count', { count: shipments.length })} actions={actions} />
      <Card>
        {shipments.length === 0 ? (
          <EmptyState
            title={t('shipments.emptyTitle')}
            action={
              <Button asChild>
                <a href="#/app/samples">{t('shipments.trySample')}</a>
              </Button>
            }
          >
            {demo ? t('shipments.emptyTextDemo') : t('shipments.emptyText')}
          </EmptyState>
        ) : (
          <>
            <ShipmentFilters value={filters} onChange={setFilters} />
            <p className="visually-hidden" role="status">
              {t('shipments.count', { count: shown.length })}
            </p>
            {shown.length === 0 ? <EmptyState title={t('shipments.noMatch')} /> : <ShipmentsTable shipments={shown} />}
          </>
        )}
      </Card>
    </div>
  );
}
