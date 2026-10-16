import type { ScreeningList } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';

/** Each list with its cached version, size, checksum and download time. */
export function ScreeningListsTable({ lists }: { lists: readonly ScreeningList[] }) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const columns: Column<ScreeningList>[] = [
    {
      key: 'list',
      header: t('screening.lists.columns.list'),
      cell: (l) => (
        <>
          <a href={l.page} target="_blank" rel="noreferrer">
            {l.name}
          </a>
          <div className="muted small">{l.publisher}</div>
          {l.sha256 && <div className="muted small mono">{t('screening.lists.checksum', { sha: l.sha256.slice(0, 16) })}</div>}
          {l.lastError && <div className="small screening-error">{t('screening.lists.failed', { error: l.lastError })}</div>}
        </>
      ),
    },
    { key: 'version', header: t('screening.lists.columns.version'), cell: (l) => (l.cached ? <span className="screening-nowrap">{l.versionDate}</span> : <span className="muted">{t('screening.lists.never')}</span>) },
    { key: 'entries', header: t('screening.lists.columns.entries'), cell: (l) => formatNumber(l.entries), numeric: true },
    { key: 'fetched', header: t('screening.lists.columns.fetched'), cell: (l) => (l.fetchedAt ? <span className="muted">{formatDateTime(l.fetchedAt)}</span> : '—'), secondary: true },
  ];
  return <DataTable columns={columns} rows={lists} rowKey={(l) => l.id} caption={t('screening.lists.title')} compact />;
}
