import type { DocumentType, ExtractedData } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EXTRACTED_ROW_HEADINGS } from '../../constants/extractedFields';
import { buildExtractedRows, type ExtractedRow } from '../../lib/buildExtractedRows';

/** Invoice lines, packages or containers, as read. */
export function ExtractedRowsTable({ type, data }: { type: DocumentType; data: ExtractedData }) {
  const rows = buildExtractedRows(type, data);
  if (rows.length === 0) return null;
  const columns: Column<ExtractedRow>[] = [
    { key: 'label', header: '', cell: (r) => <span className="muted">{r.label}</span> },
    ...(EXTRACTED_ROW_HEADINGS[type] ?? []).map((heading, i) => ({ key: heading, header: heading, cell: (r: ExtractedRow) => r.cells[i] ?? '—' })),
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.label}-${i}`} compact />;
}
