import type { ReviewQueueItem } from '../../api/review';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';
import { navigate } from '../../lib/navigate';
import { ConfidenceTag } from './ConfidenceTag';

export function ReviewQueueTable({ items }: { items: ReviewQueueItem[] }) {
  const { t } = useI18n();
  const columns: Column<ReviewQueueItem>[] = [
    {
      key: 'document',
      header: t('reviewQueue.columns.document'),
      cell: (r) => (
        <>
          <a href={`#/app/review/${r.documentId}`}>{r.fileName}</a>
          <div className="muted small">{t(DOCUMENT_TYPE_KEY[r.documentType])}</div>
        </>
      ),
    },
    { key: 'shipment', header: t('reviewQueue.columns.shipment'), cell: (r) => r.shipmentReference ?? <span className="muted">{t('reviewQueue.noReference')}</span>, secondary: true },
    { key: 'pending', header: t('reviewQueue.columns.toCheck'), cell: (r) => r.pending, numeric: true },
    { key: 'lowest', header: t('reviewQueue.columns.lowest'), cell: (r) => <ConfidenceTag confidence={r.minConfidence} low />, numeric: true },
  ];
  return <DataTable caption={t('reviewQueue.tableCaption')} columns={columns} rows={items} rowKey={(r) => r.documentId} onRowClick={(r) => navigate(`/app/review/${r.documentId}`)} />;
}
