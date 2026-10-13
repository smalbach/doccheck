import type { ExtractionReport } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { formatPercent } from '../../lib/formatPercent';

const COLUMNS: Column<ExtractionReport>[] = [
  {
    key: 'model',
    header: 'Model',
    cell: (r) => (
      <>
        {r.provider}
        {r.modelVersion && <span className="muted small"> · {r.modelVersion}</span>}
      </>
    ),
  },
  { key: 'documents', header: 'PDFs', cell: (r) => r.documents, numeric: true },
  { key: 'accuracy', header: 'Fields correct', cell: (r) => formatPercent(r.overall.accuracy), numeric: true },
];

export function ModelComparison({ reports }: { reports: readonly ExtractionReport[] }) {
  return (
    <Card title="Model comparison">
      <DataTable columns={COLUMNS} rows={reports} rowKey={(r) => r.file} compact />
      <p className="muted small">Comparisons on fewer documents are indicative only.</p>
    </Card>
  );
}
