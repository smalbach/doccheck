import type { ExtractionReport } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';

type TypeRow = ExtractionReport['byType'][number];

/** Field accuracy by document type on one evaluation set, and its weakest fields. */
export function ExtractionSetCard({ report }: { report: ExtractionReport }) {
  const { t, formatPercent } = useI18n();
  const known = (key: string) => (t(key as MessageKey) === key ? undefined : t(key as MessageKey));
  const typeLabel = (type: string) => known(`documentTypes.${type}`) ?? type;
  const columns: Column<TypeRow>[] = [
    { key: 'type', header: t('results.columns.document'), cell: (r) => typeLabel(r.type) },
    { key: 'accuracy', header: t('results.columns.fieldsCorrect'), cell: (r) => formatPercent(r.accuracy), numeric: true },
    { key: 'total', header: t('results.columns.fields'), cell: (r) => r.total, numeric: true },
  ];
  const title = known(`results.sets.${report.set}`) ?? report.set;
  return (
    <Card title={title}>
      <DataTable columns={columns} rows={report.byType} rowKey={(r) => r.type} compact caption={title} />
      {report.weakestFields.length > 0 && (
        <>
          <h3 className="small muted">{t('results.weakest')}</h3>
          <ul className="small plain">
            {report.weakestFields.slice(0, 5).map((f) => (
              <li key={f.type + f.field}>
                <code>{f.field}</code> <span className="muted">({typeLabel(f.type)})</span> {formatPercent(f.accuracy)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">{t('results.promptFailed', { prompt: report.promptVersion, count: report.failedDocuments })}</p>
    </Card>
  );
}
