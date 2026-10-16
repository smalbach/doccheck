import { useState } from 'react';
import { api } from '../../api/client';
import type { ThreadFilter } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pager } from '../../components/ui/Pager';
import { TextInput } from '../../components/ui/TextInput';
import { ToggleChips } from '../../components/ui/ToggleChips';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useAuth } from '../auth/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useMailSummary } from '../../hooks/useMailSummary';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { ThreadTable } from './ThreadTable';
import { UnassignedMail } from './UnassignedMail';
import { PreShipmentCard } from '../portal/PreShipmentCard';
import { useDemo } from '../../hooks/useDemo';

const FILTERS: readonly ThreadFilter[] = ['open', 'unread', 'awaiting', 'overdue', 'failed', 'closed', 'all'];
const PAGE = 30;

/** Every conversation with suppliers, by what needs doing. */
export function InboxPage({ initialFilter }: { initialFilter?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const demo = useDemo();
  const summary = useMailSummary();
  const [filter, setFilter] = useState<ThreadFilter>(FILTERS.includes(initialFilter as ThreadFilter) ? (initialFilter as ThreadFilter) : 'open');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { filter, q: q || undefined, limit: PAGE, offset };
  // The summary changes when a reply arrives: the list follows it.
  const { data, error, loading } = useQuery(`threads:${JSON.stringify(query)}:${JSON.stringify(summary ?? {})}`, () => api.mailThreads(query));
  const count = (f: ThreadFilter) => (f === 'unread' ? summary?.unread : f === 'awaiting' ? summary?.awaiting : f === 'overdue' ? summary?.overdue : f === 'failed' ? summary?.failed : undefined);

  return (
    <div className="page">
      <PageHeader title={t('mail.title')} description={t('mail.description')} />
      <Card>
        <div className="filters">
          <TextInput
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder={t('mail.search')}
            aria-label={t('mail.search')}
            className="filters-grow"
          />
        </div>
        <ToggleChips
          value={filter}
          options={FILTERS.map((f) => ({ value: f, label: count(f) ? `${t(`mail.filters.${f}`)} (${count(f)})` : t(`mail.filters.${f}`) }))}
          onValueChange={(f) => {
            setFilter(f);
            setOffset(0);
          }}
          ariaLabel={t('mail.filters.label')}
        />
        {!data ? (
          <LoadingCard error={error} />
        ) : (
          <>
            {error && <Banner tone="error">{error}</Banner>}
            <p className="visually-hidden" role="status">
              {loading ? t('common.loading') : t('mail.matching', { count: data.total })}
            </p>
            <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
              {data.items.length === 0 ? <EmptyState title={t('mail.none')}>{t('mail.noneText')}</EmptyState> : <ThreadTable threads={data.items} caption={t('mail.title')} />}
            </div>
            <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('mail.pages')} busy={loading} />
          </>
        )}
      </Card>
      <PreShipmentCard readOnly={demo} />
      {user?.role === 'admin' && <UnassignedMail count={summary?.unassigned ?? 0} />}
    </div>
  );
}
