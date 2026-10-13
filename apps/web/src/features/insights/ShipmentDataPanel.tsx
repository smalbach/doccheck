import { useState } from 'react';
import { api } from '../../api/client';
import type { Destination } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pager } from '../../components/ui/Pager';
import { TextInput } from '../../components/ui/TextInput';
import { INSIGHTS_PAGE_SIZE } from '../../constants/insights';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { ShipmentDataTable } from './ShipmentDataTable';

/** Per shipment: invoice, parties, incoterm, value, weights, packages, containers and route. */
export function ShipmentDataPanel({ destination }: { destination?: Destination }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { destination, q: q || undefined, limit: INSIGHTS_PAGE_SIZE, offset };
  const { data, error, loading } = useQuery(`shipments:${JSON.stringify(query)}`, () => api.insightsShipments(query));

  return (
    <div>
      <div className="filters">
        <TextInput
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder={t('insights.shipmentsSearch')}
          aria-label={t('insights.shipmentsSearch')}
          className="filters-grow"
        />
      </div>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          {error && <Banner tone="error">{error}</Banner>}
          <p className="visually-hidden" role="status">
            {loading ? t('common.loading') : t('shipments.matching', { count: data.total })}
          </p>
          <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
            {data.items.length === 0 ? <EmptyState title={t('insights.noShipments')} /> : <ShipmentDataTable rows={data.items} />}
          </div>
          <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('shipments.pages')} busy={loading} />
        </>
      )}
    </div>
  );
}
