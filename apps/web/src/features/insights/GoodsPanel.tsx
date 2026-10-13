import { useState } from 'react';
import { api } from '../../api/client';
import type { Destination } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pager } from '../../components/ui/Pager';
import { TextInput } from '../../components/ui/TextInput';
import { INSIGHTS_PAGE_SIZE, type GoodsFilterState } from '../../constants/insights';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { ExportCsvButton } from './ExportCsvButton';
import { GoodsTable } from './GoodsTable';

export interface GoodsPanelProps {
  destination?: Destination;
  filters: GoodsFilterState;
  onFiltersChange: (filters: GoodsFilterState) => void;
  /** Always applied: the lines of one company's invoices, or of one product. */
  scope?: { party?: string; product?: string };
}

const ORIGIN = /^[A-Za-z]{2}$/;
const HS = /^[\d.]{2,13}$/;

/** Every invoice line of every shipment, searchable by text, origin and HS code. */
export function GoodsPanel({ destination, filters, onFiltersChange, scope }: GoodsPanelProps) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const settled = useDebouncedValue(filters, SEARCH_DEBOUNCE_MS);
  // Half-typed codes are not sent: the API would refuse them.
  const filtersQuery = {
    destination,
    ...scope,
    q: settled.query.trim() || undefined,
    origin: ORIGIN.test(settled.origin.trim()) ? settled.origin.trim().toUpperCase() : undefined,
    hs: HS.test(settled.hs.trim()) ? settled.hs.trim() : undefined,
  };
  const query = { ...filtersQuery, limit: INSIGHTS_PAGE_SIZE, offset };
  const { data, error, loading } = useQuery(`goods:${JSON.stringify(query)}`, () => api.insightsLines(query));
  const change = (patch: Partial<GoodsFilterState>) => {
    onFiltersChange({ ...filters, ...patch });
    setOffset(0);
  };

  return (
    <div>
      <div className="filters">
        <TextInput type="search" value={filters.query} onChange={(e) => change({ query: e.target.value })} placeholder={t('insights.goodsSearch')} aria-label={t('insights.goodsSearch')} className="filters-grow" />
        <div className="filters-right">
          <TextInput value={filters.origin} maxLength={2} onChange={(e) => change({ origin: e.target.value })} placeholder={t('insights.originPlaceholder')} aria-label={t('insights.columns.origin')} className="mono input-short" />
          <TextInput value={filters.hs} maxLength={13} inputMode="decimal" onChange={(e) => change({ hs: e.target.value })} placeholder={t('insights.hsPlaceholder')} aria-label={t('insights.columns.hs')} className="mono input-short" />
          <ExportCsvButton href={api.insightsLinesCsvUrl(filtersQuery)} />
        </div>
      </div>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          {error && <Banner tone="error">{error}</Banner>}
          <p className="visually-hidden" role="status">
            {loading ? t('common.loading') : t('insights.linesMatching', { count: data.total })}
          </p>
          <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
            {data.items.length === 0 ? <EmptyState title={t('insights.noLines')} /> : <GoodsTable lines={data.items} />}
          </div>
          <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('insights.goodsPages')} busy={loading} />
        </>
      )}
    </div>
  );
}
