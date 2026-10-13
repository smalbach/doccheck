import type { DocumentType, ExtractedData } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { EXTRACTED_ROW_HEADINGS } from '../../constants/extractedFields';
import { useI18n } from '../../i18n/useI18n';
import { buildExtractedRows, type ExtractedRow } from '../../lib/buildExtractedRows';

/** Invoice lines, packages or containers, as read. */
export function ExtractedRowsTable({ type, data }: { type: DocumentType; data: ExtractedData }) {
  const { t } = useI18n();
  const rows = buildExtractedRows(type, data);
  if (rows.length === 0) return null;
  const columns: Column<ExtractedRow>[] = [
    { key: 'label', header: <span className="visually-hidden">#</span>, cell: (r) => <span className="muted">{r.isLine ? t('extracted.line', { number: r.label }) : r.label}</span> },
    ...(EXTRACTED_ROW_HEADINGS[type] ?? []).map((heading, i) => ({ key: heading, header: t(heading), cell: (r: ExtractedRow) => r.cells[i] ?? '—' })),
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.label}-${i}`} compact caption={t(DOCUMENT_TYPE_KEY[type])} />;
}
