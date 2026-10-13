import { useState } from 'react';
import { api } from '../../api/client';
import type { Destination, PartySummary } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pager } from '../../components/ui/Pager';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { INSIGHTS_PAGE_SIZE, PARTY_ROLE_FILTERS, type PartyRoleFilter } from '../../constants/insights';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { MoneyList } from './MoneyList';
import { RoleTags } from './RoleTags';

export interface PartiesPanelProps {
  destination?: Destination;
  onOpen: (id: string) => void;
}

/** The companies of the user's documents, each once however it is spelled, with what was invoiced with it. */
export function PartiesPanel({ destination, onOpen }: PartiesPanelProps) {
  const { t, formatNumber } = useI18n();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<PartyRoleFilter>('supplier');
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { destination, q: q || undefined, role: role === 'any' ? undefined : role, limit: INSIGHTS_PAGE_SIZE, offset };
  const { data, error, loading } = useQuery(`parties:${JSON.stringify(query)}`, () => api.insightsParties(query));

  const columns: Column<PartySummary>[] = [
    {
      key: 'company',
      header: t('insights.parties.columns.company'),
      cell: (p) => (
        <div className="cell-wide">
          {p.name}
          <span className="muted small block">
            {[p.country, p.names.length > 1 ? t('insights.parties.spellings', { count: p.names.length }) : undefined].filter(Boolean).join(' · ')}
          </span>
        </div>
      ),
    },
    { key: 'roles', header: t('insights.parties.columns.roles'), cell: (p) => <RoleTags roles={p.roles} />, secondary: true },
    { key: 'shipments', header: t('insights.parties.columns.shipments'), cell: (p) => formatNumber(p.shipments), numeric: true },
    { key: 'invoices', header: t('insights.parties.columns.invoices'), cell: (p) => formatNumber(p.invoices), numeric: true, secondary: true },
    { key: 'value', header: t('insights.parties.columns.value'), cell: (p) => <MoneyList totals={p.values} stacked />, numeric: true },
    {
      key: 'period',
      header: t('insights.parties.columns.period'),
      cell: (p) => <span className="nowrap small">{p.firstDate ? (p.firstDate === p.lastDate ? p.firstDate : `${p.firstDate} → ${p.lastDate}`) : '—'}</span>,
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
          placeholder={t('insights.parties.search')}
          aria-label={t('insights.parties.search')}
          className="filters-grow"
        />
        <div className="filters-right">
          <ToggleChips
            value={role}
            options={PARTY_ROLE_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
            onValueChange={(v) => {
              setRole(v);
              setOffset(0);
            }}
            ariaLabel={t('insights.parties.roleFilter')}
          />
        </div>
      </div>
      <p className="muted small">{t('insights.parties.hint')}</p>
      {!data ? (
        <LoadingCard error={error} />
      ) : (
        <>
          {error && <Banner tone="error">{error}</Banner>}
          <p className="visually-hidden" role="status">
            {loading ? t('common.loading') : t('insights.parties.matching', { count: data.total })}
          </p>
          <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
            {data.items.length === 0 ? (
              <EmptyState title={t('insights.parties.none')} />
            ) : (
              <DataTable columns={columns} rows={data.items} rowKey={(p) => p.id} onRowClick={(p) => onOpen(p.id)} caption={t('insights.tabs.parties')} />
            )}
          </div>
          <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('insights.parties.pages')} busy={loading} />
        </>
      )}
    </div>
  );
}
