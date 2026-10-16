import type { ShipmentSummary } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useI18n } from '../../i18n/useI18n';

/** The reference is a real link, so the row works with the keyboard, middle-click and screen readers. */
export function ShipmentsTable({ shipments }: { shipments: readonly ShipmentSummary[] }) {
  const { t, formatDateTime } = useI18n();
  const columns: Column<ShipmentSummary>[] = [
    { key: 'reference', header: t('shipments.columns.reference'), cell: (s) => <a href={`#/app/s/${s.id}`}>{s.reference ?? s.id.slice(0, 8)}</a> },
    { key: 'destination', header: t('shipments.columns.destination'), cell: (s) => s.destination ?? '—', secondary: true },
    { key: 'status', header: t('shipments.columns.status'), cell: (s) => <StatusBadge status={s.status} /> },
    { key: 'documents', header: t('shipments.columns.documents'), cell: (s) => s.documentCount, numeric: true, secondary: true },
    { key: 'findings', header: t('shipments.columns.findings'), cell: (s) => s.findingCount ?? '—', numeric: true },
    {
      key: 'due',
      header: t('team.columns.due'),
      cell: (s) => (s.dueAt ? <span className={s.overdue ? 'error' : 'muted'}>{formatDateTime(s.dueAt)}{s.overdue ? ` · ${t('team.filters.overdue')}` : ''}</span> : '—'),
      secondary: true,
    },
    { key: 'assignee', header: t('team.columns.assignee'), cell: (s) => s.assignee?.name ?? '—', secondary: true },
    { key: 'created', header: t('shipments.columns.created'), cell: (s) => <span className="muted">{formatDateTime(s.createdAt)}</span>, secondary: true },
  ];
  return <DataTable columns={columns} rows={shipments} rowKey={(s) => s.id} caption={t('shipments.caption')} />;
}
