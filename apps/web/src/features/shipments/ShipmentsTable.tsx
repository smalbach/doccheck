import type { ShipmentSummary } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatDateTime } from '../../lib/formatDateTime';
import { navigate } from '../../lib/navigate';

const COLUMNS: Column<ShipmentSummary>[] = [
  { key: 'reference', header: 'Reference', cell: (s) => s.reference ?? <span className="muted">{s.id.slice(0, 8)}</span> },
  { key: 'destination', header: 'Destination', cell: (s) => s.destination ?? '—', secondary: true },
  { key: 'status', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
  { key: 'documents', header: 'Documents', cell: (s) => s.documentCount, numeric: true, secondary: true },
  { key: 'findings', header: 'Findings', cell: (s) => s.findingCount ?? '—', numeric: true },
  { key: 'created', header: 'Created', cell: (s) => <span className="muted">{formatDateTime(s.createdAt)}</span>, secondary: true },
];

export function ShipmentsTable({ shipments }: { shipments: readonly ShipmentSummary[] }) {
  return <DataTable columns={COLUMNS} rows={shipments} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/app/s/${s.id}`)} caption="Shipments" />;
}
