import type { InsightsSummary } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { formatHsCode } from '../../lib/formatHsCode';
import { MoneyList } from './MoneyList';

type Row = InsightsSummary['byHsCode'][number];

export interface HsBreakdownProps {
  rows: readonly Row[];
  onShow: (hs: string) => void;
}

/** Invoice lines per HS subheading (six digits), with the most common description. */
export function HsBreakdown({ rows, onShow }: HsBreakdownProps) {
  const { t } = useI18n();
  const columns: Column<Row>[] = [
    {
      key: 'hs',
      header: t('insights.columns.hs'),
      cell: (r) =>
        r.hsCode ? (
          <Button variant="link" size="sm" className="mono" onClick={() => onShow(r.hsCode!)} aria-label={t('insights.showLinesOf', { name: formatHsCode(r.hsCode) })}>
            {formatHsCode(r.hsCode)}
          </Button>
        ) : (
          <span className="muted">{t('insights.unknown')}</span>
        ),
    },
    { key: 'description', header: t('insights.columns.description'), cell: (r) => r.description, secondary: true },
    { key: 'lines', header: t('insights.columns.lines'), cell: (r) => r.lines, numeric: true },
    { key: 'value', header: t('insights.columns.value'), cell: (r) => <MoneyList totals={r.values} />, numeric: true },
  ];
  return (
    <section>
      <h2 className="section-title">{t('insights.byHs')}</h2>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.hsCode ?? '-'} caption={t('insights.byHs')} compact />
    </section>
  );
}
