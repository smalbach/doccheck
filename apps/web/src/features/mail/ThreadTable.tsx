import type { ThreadSummary } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { ThreadTags } from './ThreadTags';

export interface ThreadTableProps {
  threads: readonly ThreadSummary[];
  caption: string;
  /** Hide the shipment column (inside a shipment's page). */
  hideShipment?: boolean;
  compact?: boolean;
}

/** Conversations, newest activity first; a row opens the conversation. */
export function ThreadTable({ threads, caption, hideShipment, compact }: ThreadTableProps) {
  const { t, formatDateTime } = useI18n();
  const columns: Column<ThreadSummary>[] = [
    {
      key: 'subject',
      header: t('mail.columns.subject'),
      cell: (x) => (
        <div className="cell-wide">
          <a href={`#/app/inbox/${x.id}`} className={x.unread ? 'thread-unread' : undefined}>
            {x.subject}
          </a>
          <span className="muted small block">{t(`mail.kind.${x.kind}`)}</span>
        </div>
      ),
    },
    { key: 'with', header: t('mail.columns.with'), cell: (x) => <span className="small">{x.partyName ?? x.counterpart ?? '—'}</span>, secondary: true },
    ...(hideShipment
      ? []
      : [
          {
            key: 'about',
            header: t('mail.columns.about'),
            cell: (x: ThreadSummary) => (x.shipmentId ? <a href={`#/app/s/${x.shipmentId}`}>{x.shipmentReference ?? x.shipmentId.slice(0, 8)}</a> : '—'),
            secondary: true,
          },
        ]),
    { key: 'status', header: t('mail.columns.status'), cell: (x) => <ThreadTags thread={x} /> },
    { key: 'last', header: t('mail.columns.last'), cell: (x) => <span className="nowrap small">{formatDateTime(x.lastMessageAt)}</span>, secondary: true },
  ];
  return <DataTable compact={compact} columns={columns} rows={threads} rowKey={(x) => x.id} onRowClick={(x) => (window.location.hash = `#/app/inbox/${x.id}`)} caption={caption} />;
}
