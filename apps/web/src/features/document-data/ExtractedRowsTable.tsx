import type { DocumentType, ExtractedData } from '../../api/types';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Tag } from '../../components/ui/Tag';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { EXTRACTED_ROW_HEADINGS } from '../../constants/extractedFields';
import { useI18n } from '../../i18n/useI18n';
import { buildExtractedRows, type ExtractedRow } from '../../lib/buildExtractedRows';
import { isCorrected } from '../../lib/isCorrected';

export interface ExtractedRowsTableProps {
  type: DocumentType;
  data: ExtractedData;
  /** Values corrected by hand: pointer → what the model read. */
  corrected: ReadonlyMap<string, unknown>;
}

/** Invoice lines, packages or containers, as read (rows with a value corrected by hand are tagged). */
export function ExtractedRowsTable({ type, data, corrected }: ExtractedRowsTableProps) {
  const { t } = useI18n();
  const rows = buildExtractedRows(type, data);
  if (rows.length === 0) return null;
  const label = (r: ExtractedRow) => (
    <span className="muted">
      {r.isLine ? t('extracted.line', { number: r.label }) : r.label}
      {isCorrected(corrected, r.pointer) && (
        <>
          {' '}
          <Tag tone="accent">{t('extracted.corrected')}</Tag>
        </>
      )}
    </span>
  );
  const columns: Column<ExtractedRow>[] = [
    { key: 'label', header: <span className="visually-hidden">#</span>, cell: label },
    ...(EXTRACTED_ROW_HEADINGS[type] ?? []).map((heading, i) => ({ key: heading, header: t(heading), cell: (r: ExtractedRow) => r.cells[i] ?? '—' })),
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.label}-${i}`} compact caption={t(DOCUMENT_TYPE_KEY[type])} />;
}
