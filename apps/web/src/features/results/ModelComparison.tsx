import type { ExtractionReport } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';

export function ModelComparison({ reports }: { reports: readonly ExtractionReport[] }) {
  const { t, formatPercent } = useI18n();
  const columns: Column<ExtractionReport>[] = [
    {
      key: 'model',
      header: t('results.columns.model'),
      cell: (r) => (
        <>
          {r.provider}
          {r.modelVersion && <span className="muted small"> · {r.modelVersion}</span>}
        </>
      ),
    },
    { key: 'documents', header: t('results.columns.pdfs'), cell: (r) => r.documents, numeric: true },
    { key: 'accuracy', header: t('results.columns.fieldsCorrect'), cell: (r) => formatPercent(r.overall.accuracy), numeric: true },
  ];
  return (
    <Card title={t('results.comparison')}>
      <DataTable columns={columns} rows={reports} rowKey={(r) => r.file} compact caption={t('results.comparison')} />
      <p className="muted small">{t('results.comparisonNote')}</p>
    </Card>
  );
}
