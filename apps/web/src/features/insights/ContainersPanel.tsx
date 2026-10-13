import { useState } from 'react';
import { api } from '../../api/client';
import type { ContainerRow, Destination } from '../../api/types';
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

/** Containers matching a search, paged. */
export function ContainersPanel({ destination }: { destination?: Destination }) {
  const { t, formatNumber } = useI18n();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { destination, q: q || undefined, limit: INSIGHTS_PAGE_SIZE, offset };
  const { data, error, loading } = useQuery(`containers:${JSON.stringify(query)}`, () => api.insightsContainers(query));

  const columns: Column<ContainerRow>[] = [
    {
      key: 'container',
      header: t('insights.containers.columns.container'),
      cell: (c) => (
        <>
          <span className="mono nowrap">{c.number}</span>
          <span className="muted small block nowrap">
            <a href={`#/app/s/${c.shipmentId}`}>{c.reference ?? c.shipmentId.slice(0, 8)}</a>
            {c.destination && ` · ${c.destination}`}
          </span>
        </>
      ),
    },
    { key: 'type', header: t('insights.containers.columns.type'), cell: (c) => c.sizeType ?? '—' },
    { key: 'seal', header: t('insights.containers.columns.seal'), cell: (c) => (c.seal ? <span className="mono small">{c.seal}</span> : '—'), secondary: true },
    { key: 'packages', header: t('insights.containers.columns.packages'), cell: (c) => (c.packages === undefined ? '—' : formatNumber(c.packages)), numeric: true },
    { key: 'weight', header: t('insights.containers.columns.weight'), cell: (c) => <span className="nowrap">{c.grossKg ? `${formatNumber(c.grossKg, 1)} kg` : '—'}</span>, numeric: true, secondary: true },
    {
      key: 'bl',
      header: t('insights.containers.columns.bl'),
      cell: (c) => (
        <>
          <span className="nowrap">{c.blNumber ?? '—'}</span>
          {c.carrier && <span className="muted small block">{[c.carrier, c.scac].filter(Boolean).join(' · ')}</span>}
        </>
      ),
      secondary: true,
    },
    {
      key: 'route',
      header: t('insights.containers.columns.route'),
      cell: (c) => (
        <>
          {c.portOfLoading || c.portOfDischarge ? `${c.portOfLoading ?? '?'} → ${c.portOfDischarge ?? '?'}` : '—'}
          {(c.vessel || c.shippedDate) && <span className="muted small block">{[c.vessel, c.shippedDate].filter(Boolean).join(' · ')}</span>}
        </>
      ),
      secondary: true,
    },
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
          placeholder={t('insights.containers.search')}
          aria-label={t('insights.containers.search')}
          className="filters-grow"
        />
      </div>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          {error && <Banner tone="error">{error}</Banner>}
          <p className="visually-hidden" role="status">
            {loading ? t('common.loading') : t('insights.containers.matching', { count: data.total })}
          </p>
          <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
            {data.items.length === 0 ? (
              <EmptyState title={t('insights.containers.none')} />
            ) : (
              <DataTable columns={columns} rows={data.items} rowKey={(c) => `${c.documentId}:${c.number}`} caption={t('insights.pages.containers.title')} />
            )}
          </div>
          <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('insights.containers.pages')} busy={loading} />
        </>
      )}
    </div>
  );
}
