import { ArchiveIcon, ClockIcon, CrossCircledIcon, EnvelopeClosedIcon, EnvelopeOpenIcon, ExclamationTriangleIcon, ReloadIcon, StackIcon } from '@radix-ui/react-icons';
import { useState, type ComponentType } from 'react';
import { api } from '../../api/client';
import type { ThreadFilter } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Pager } from '../../components/ui/Pager';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/TextInput';
import { cx } from '../../lib/cx';
import { SEARCH_DEBOUNCE_MS } from '../../constants/shipmentFilters';
import { useAuth } from '../auth/useAuth';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { refreshMailSummary, useMailSummary } from '../../hooks/useMailSummary';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { ThreadList } from './ThreadList';
import { UnassignedMail } from './UnassignedMail';
import { PreShipmentCard } from '../portal/PreShipmentCard';
import { useDemo } from '../../hooks/useDemo';

const FILTERS: readonly ThreadFilter[] = ['open', 'unread', 'awaiting', 'overdue', 'failed', 'closed', 'all'];
const PAGE = 30;
const ICONS: Record<ThreadFilter, ComponentType<{ 'aria-hidden'?: boolean }>> = {
  open: EnvelopeOpenIcon,
  unread: EnvelopeClosedIcon,
  awaiting: ClockIcon,
  overdue: ExclamationTriangleIcon,
  failed: CrossCircledIcon,
  closed: ArchiveIcon,
  all: StackIcon,
};

/** Every conversation with suppliers, by what needs doing. */
export function InboxPage({ initialFilter }: { initialFilter?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const demo = useDemo();
  const summary = useMailSummary();
  const [filter, setFilter] = useState<ThreadFilter>(FILTERS.includes(initialFilter as ThreadFilter) ? (initialFilter as ThreadFilter) : 'open');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const query = { filter, q: q || undefined, limit: PAGE, offset };
  // The summary changes when a reply arrives: the list follows it.
  const { data, error, loading } = useQuery(`threads:${JSON.stringify(query)}:${JSON.stringify(summary ?? {})}:${tick}`, () => api.mailThreads(query));
  const count = (f: ThreadFilter) => (f === 'unread' ? summary?.unread : f === 'awaiting' ? summary?.awaiting : f === 'overdue' ? summary?.overdue : f === 'failed' ? summary?.failed : undefined);

  const pick = (f: ThreadFilter) => {
    setFilter(f);
    setOffset(0);
  };

  return (
    <div className="page mail-page">
      <PageHeader title={t('mail.title')} description={t('mail.description')} />
      <div className="mailbox">
        <nav className="mail-folders" aria-label={t('mail.filters.label')}>
          {FILTERS.map((f) => {
            const Icon = ICONS[f];
            const n = count(f);
            return (
              <button key={f} type="button" className={cx('mail-folder', filter === f && 'is-active', (f === 'overdue' || f === 'failed') && n ? 'is-alert' : undefined)} aria-pressed={filter === f} onClick={() => pick(f)}>
                <Icon aria-hidden />
                <span className="mail-folder-name">{t(`mail.filters.${f}`)}</span>
                {n ? <span className="mail-folder-count">{n}</span> : null}
              </button>
            );
          })}
        </nav>
        <section className="mail-pane" aria-label={t(`mail.filters.${filter}`)}>
          <div className="mail-toolbar">
            <TextInput
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder={t('mail.search')}
              aria-label={t('mail.search')}
              className="mail-search"
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('mail.refresh')}
              title={t('mail.refresh')}
              onClick={() => {
                refreshMailSummary();
                setTick((n) => n + 1);
              }}
            >
              <ReloadIcon aria-hidden />
            </Button>
            {data && <Pager offset={data.offset} limit={data.limit} total={data.total} onOffsetChange={setOffset} label={t('mail.pages')} busy={loading} />}
          </div>
          {!data ? (
            <LoadingCard error={error} />
          ) : (
            <>
              {error && <Banner tone="error">{error}</Banner>}
              <p className="visually-hidden" role="status">
                {loading ? t('common.loading') : t('mail.matching', { count: data.total })}
              </p>
              <div aria-busy={loading} className={loading ? 'is-refreshing' : undefined}>
                {data.items.length === 0 ? <EmptyState title={t('mail.none')}>{t('mail.noneText')}</EmptyState> : <ThreadList threads={data.items} label={t(`mail.filters.${filter}`)} />}
              </div>
            </>
          )}
        </section>
      </div>
      <PreShipmentCard readOnly={demo} />
      {user?.role === 'admin' && <UnassignedMail count={summary?.unassigned ?? 0} />}
    </div>
  );
}
