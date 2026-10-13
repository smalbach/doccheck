import type { ExtractionReport } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';
import { EVALUATION_SET_LABEL } from '../../constants/results';
import { formatPercent } from '../../lib/formatPercent';

type TypeRow = ExtractionReport['byType'][number];

const typeLabel = (type: string) => DOCUMENT_TYPE_LABEL[type as keyof typeof DOCUMENT_TYPE_LABEL] ?? type;

const COLUMNS: Column<TypeRow>[] = [
  { key: 'type', header: 'Document', cell: (t) => typeLabel(t.type) },
  { key: 'accuracy', header: 'Fields correct', cell: (t) => formatPercent(t.accuracy), numeric: true },
  { key: 'total', header: 'Fields', cell: (t) => t.total, numeric: true },
];

/** Field accuracy by document type on one evaluation set, and its weakest fields. */
export function ExtractionSetCard({ report }: { report: ExtractionReport }) {
  return (
    <Card title={EVALUATION_SET_LABEL[report.set] ?? report.set}>
      <DataTable columns={COLUMNS} rows={report.byType} rowKey={(t) => t.type} compact />
      {report.weakestFields.length > 0 && (
        <>
          <h3 className="small muted">Weakest fields</h3>
          <ul className="small plain">
            {report.weakestFields.slice(0, 5).map((f) => (
              <li key={f.type + f.field}>
                <code>{f.field}</code> <span className="muted">({typeLabel(f.type)})</span> {formatPercent(f.accuracy)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">
        prompt {report.promptVersion} · {report.failedDocuments} failed
      </p>
    </Card>
  );
}
