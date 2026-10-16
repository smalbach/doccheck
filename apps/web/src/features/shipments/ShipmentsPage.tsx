import { PlusIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pager } from '../../components/ui/Pager';
import { INITIAL_SHIPMENT_FILTERS, SEARCH_DEBOUNCE_MS, SHIPMENTS_PAGE_SIZE, type ShipmentFilterState } from '../../constants/shipmentFilters';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDemo } from '../../hooks/useDemo';
import { useShipmentList } from '../../hooks/useShipmentList';
import { useI18n } from '../../i18n/useI18n';
import { useOrg } from '../team/useOrg';
import { ShipmentFilters } from './ShipmentFilters';
import { ShipmentsTable } from './ShipmentsTable';

/** The organization's shipments, filtered and paged by the API; `due` and `assignee` come from dashboard links. */
export function ShipmentsPage({ due, assignee }: { due?: 'overdue' | 'soon'; assignee?: string } = {}) {
  const { t } = useI18n();
  const { can } = useOrg();
  // Read-only: the demo, or a role that cannot create shipments.
  const demo = useDemo() || !can('shipment.write');
  const [filters, setFilters] = useState<ShipmentFilterState>({ ...INITIAL_SHIPMENT_FILTERS, due: due ?? 'any', mine: assignee === 'me' });
  const [offset, setOffset] = useState(0);
  const query = useDebouncedValue(filters.query.trim(), SEARCH_DEBOUNCE_MS);
  const { page, error, loading } = useShipmentList({
    status: filters.status,
    destination: filters.destination === 'any' ? undefined : filters.destination,
    q: query || undefined,
    due: filters.due === 'any' ? undefined : filters.due,
    assignee: filters.mine ? 'me' : undefined,
    limit: SHIPMENTS_PAGE_SIZE,
    offset,
  });

  if (!page) return <LoadingCard error={error} />;
  const changeFilters = (next: ShipmentFilterState) => {
    setFilters(next);
    setOffset(0);
  };
  const actions = !demo && (
    <Button asChild variant="primary">
      <a href="#/app/shipments/new">
        <PlusIcon aria-hidden /> {t('shipments.new')}
      </a>
    </Button>
  );
  return (
    <div className="page">
      <PageHeader title={t('shipments.title')} description={t('shipments.count', { count: page.summary.all })} actions={actions} />
      <Card>
        {page.summary.all === 0 ? (
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
            <ShipmentFilters value={filters} counts={page.summary} onChange={changeFilters} />
            {error && <Banner tone="error">{error}</Banner>}
            <p className="visually-hidden" role="status">
              {loading ? t('common.loading') : t('shipments.matching', { count: page.total })}
            </p>
            <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
              {page.items.length === 0 ? <EmptyState title={t('shipments.noMatch')} /> : <ShipmentsTable shipments={page.items} />}
            </div>
            <Pager offset={page.offset} limit={page.limit} total={page.total} onOffsetChange={setOffset} label={t('shipments.pages')} busy={loading} />
          </>
        )}
      </Card>
    </div>
  );
}
