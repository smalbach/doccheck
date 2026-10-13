import { useState } from 'react';
import { api } from '../../api/client';
import type { Destination, ProductSummary } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pager } from '../../components/ui/Pager';
import { TextInput } from '../../components/ui/TextInput';
import { INSIGHTS_PAGE_SIZE } from '../../constants/insights';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';

export interface ProductsPanelProps {
  destination?: Destination;
  onOpen: (id: string) => void;
}

/** Every product bought, with how much, from how many sellers and at what price. */
export function ProductsPanel({ destination, onOpen }: ProductsPanelProps) {
  const { t, formatNumber, formatMoney } = useI18n();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { destination, q: q || undefined, limit: INSIGHTS_PAGE_SIZE, offset };
  const { data, error, loading } = useQuery(`products:${JSON.stringify(query)}`, () => api.insightsProducts(query));

  const columns: Column<ProductSummary>[] = [
    {
      key: 'product',
      header: t('insights.products.columns.product'),
      cell: (p) => (
        <div className="cell-wide">
          {p.description}
          <span className="muted small block">{[p.sku, p.hsCode && formatHsCode(p.hsCode), p.countryOfOrigin].filter(Boolean).join(' · ')}</span>
        </div>
      ),
    },
    { key: 'lines', header: t('insights.products.columns.lines'), cell: (p) => formatNumber(p.lines), numeric: true },
    { key: 'quantity', header: t('insights.products.columns.quantity'), cell: (p) => <span className="nowrap">{p.quantities.map((q) => `${formatNumber(q.amount)} ${q.key}`).join(' · ') || '—'}</span>, numeric: true, secondary: true },
    {
      key: 'avg',
      header: <span title={t('insights.products.avgHint')}>{t('insights.products.columns.avgPrice')}</span>,
      cell: (p) => (
        <>
          {p.prices.map((s) => (
            <span key={s.currency} className="nowrap block">{formatMoney(s.avg, s.currency)}</span>
          ))}
          {p.prices.length === 0 && '—'}
        </>
      ),
      numeric: true,
    },
    {
      key: 'last',
      header: t('insights.products.columns.lastPrice'),
      cell: (p) => (
        <>
          {p.prices.map((s) => (
            <span key={s.currency} className="nowrap block">{formatMoney(s.last, s.currency)}</span>
          ))}
          {p.prices.length === 0 && '—'}
          {p.lastDate && <span className="muted small block nowrap">{p.lastDate}</span>}
        </>
      ),
      numeric: true,
      secondary: true,
    },
    { key: 'sellers', header: t('insights.products.columns.sellers'), cell: (p) => formatNumber(p.sellers), numeric: true, secondary: true },
  ];

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
          placeholder={t('insights.products.search')}
          aria-label={t('insights.products.search')}
          className="filters-grow"
        />
      </div>
      <p className="muted small">{t('insights.products.hint')}</p>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          {error && <Banner tone="error">{error}</Banner>}
          <p className="visually-hidden" role="status">
            {loading ? t('common.loading') : t('insights.products.matching', { count: data.total })}
          </p>
          <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
            {data.items.length === 0 ? (
              <EmptyState title={t('insights.products.none')} />
            ) : (
              <DataTable columns={columns} rows={data.items} rowKey={(p) => p.id} onRowClick={(p) => onOpen(p.id)} caption={t('insights.tabs.products')} />
            )}
          </div>
          <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('insights.products.pages')} busy={loading} />
        </>
      )}
    </div>
  );
}
