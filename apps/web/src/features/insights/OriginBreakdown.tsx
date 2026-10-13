import type { InsightsSummary } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useI18n } from '../../i18n/useI18n';
import { countryName } from '../../lib/countryName';
import { MoneyList } from './MoneyList';

type Row = InsightsSummary['byOrigin'][number];

export interface OriginBreakdownProps {
  rows: readonly Row[];
  onShow: (origin: string) => void;
}

/** Invoice lines and their value per country of origin, most lines first. */
export function OriginBreakdown({ rows, onShow }: OriginBreakdownProps) {
  const { t, locale } = useI18n();
  const columns: Column<Row>[] = [
    {
      key: 'origin',
      header: t('insights.columns.origin'),
      cell: (r) =>
        r.country ? (
          <Button variant="link" size="sm" onClick={() => onShow(r.country!)} aria-label={t('insights.showLinesOf', { name: countryName(r.country, locale) })}>
            {countryName(r.country, locale)}
          </Button>
        ) : (
          <span className="muted">{t('insights.unknown')}</span>
        ),
    },
    { key: 'lines', header: t('insights.columns.lines'), cell: (r) => r.lines, numeric: true },
    { key: 'value', header: t('insights.columns.value'), cell: (r) => <MoneyList totals={r.values} />, numeric: true },
  ];
  return (
    <section>
      <h2 className="section-title">{t('insights.byOrigin')}</h2>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.country ?? '-'} caption={t('insights.byOrigin')} compact />
    </section>
  );
}
