import { analyticsApi, type AnalyticsFilter, type SupplierRow } from '../../api/analytics';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Tag } from '../../components/ui/Tag';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { formatPercent } from '../../lib/formatPercent';
import { ExportCsvButton } from '../insights/ExportCsvButton';
import { AnalyticsPage, filterKey } from './AnalyticsPage';
import { RateCell } from './RateCell';
import { ScoreFormula } from './ScoreFormula';

/** Every supplier ranked by score, with the formula behind it. */
export function SuppliersPage() {
  return (
    <AnalyticsPage titleKey="analytics.suppliers.title" descriptionKey="analytics.suppliers.description" actions={(f) => <ExportCsvButton href={analyticsApi.suppliersCsvUrl(f)} />}>
      {(filter) => <SuppliersBody filter={filter} />}
    </AnalyticsPage>
  );
}

function SuppliersBody({ filter }: { filter: AnalyticsFilter }) {
  const { t, locale, formatNumber } = useI18n();
  const { data, error } = useQuery(`suppliers:${filterKey(filter)}`, () => analyticsApi.suppliers(filter));
  if (!data) return <LoadingCard error={error} />;
  const columns: Column<SupplierRow>[] = [
    { key: 'rank', header: t('analytics.suppliers.columns.rank'), cell: (s) => s.rank ?? '—', numeric: true },
    {
      key: 'supplier',
      header: t('analytics.suppliers.columns.supplier'),
      cell: (s) => (
        <div className="cell-wide">
          <a href={`#/app/analytics/suppliers/${s.partyId}`}>{s.name}</a>
          {s.country && <span className="muted small block">{s.country}</span>}
        </div>
      ),
    },
    {
      key: 'score',
      header: t('analytics.suppliers.columns.score'),
      cell: (s) =>
        s.score.score === null ? (
          <span className="muted">{t('analytics.suppliers.noScore')}</span>
        ) : (
          <span className="score-cell">
            <RateCell part={s.score.score} total={100} />
            <span className="score-number">{s.score.score}</span>
            {s.score.lowData && <Tag>{t('analytics.suppliers.lowData')}</Tag>}
          </span>
        ),
    },
    { key: 'first', header: t('analytics.suppliers.columns.firstPass'), cell: (s) => formatPercent(s.score.components.firstPass, locale), numeric: true },
    { key: 'corrected', header: t('analytics.suppliers.columns.correction'), cell: (s) => formatPercent(s.score.components.correction, locale), numeric: true, secondary: true },
    {
      key: 'response',
      header: t('analytics.suppliers.columns.response'),
      cell: (s) => (s.medianResponseHours === null ? '—' : t('analytics.common.hours', { value: formatNumber(s.medianResponseHours, 1) })),
      numeric: true,
      secondary: true,
    },
    { key: 'shipments', header: t('analytics.suppliers.columns.shipments'), cell: (s) => formatNumber(s.validatedShipments), numeric: true },
  ];
  return (
    <Card>
      {data.length === 0 ? (
        <EmptyState title={t('analytics.common.noData')}>{t('analytics.common.noDataText')}</EmptyState>
      ) : (
        <DataTable columns={columns} rows={data} rowKey={(s) => s.partyId} caption={t('analytics.suppliers.caption')} />
      )}
      <ScoreFormula />
    </Card>
  );
}
