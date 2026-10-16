import { analyticsApi, type AnalyticsFilter, type KpiMonth } from '../../api/analytics';
import type { DocumentType } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState } from '../../components/ui/EmptyState';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { countryName } from '../../lib/countryName';
import { formatPercent } from '../../lib/formatPercent';
import { ruleLabel } from '../../lib/ruleLabel';
import { StatTile } from '../dashboard/StatTile';
import { ExportCsvButton } from '../insights/ExportCsvButton';
import { AnalyticsPage, filterKey } from './AnalyticsPage';
import { GroupTable } from './GroupTable';
import { MonthChart } from './MonthChart';
import { useMonthLabel } from '../../hooks/useMonthLabel';

/** First-pass quality over time and by rule, document, supplier, origin and route, with resolution and response times. */
export function KpisPage() {
  return (
    <AnalyticsPage titleKey="analytics.kpis.title" descriptionKey="analytics.kpis.description" actions={(f) => <ExportCsvButton href={analyticsApi.kpisCsvUrl(f)} />}>
      {(filter) => <KpisBody filter={filter} />}
    </AnalyticsPage>
  );
}

function KpisBody({ filter }: { filter: AnalyticsFilter }) {
  const { t, locale, formatNumber } = useI18n();
  const monthLabel = useMonthLabel();
  const { data, error } = useQuery(`kpis:${filterKey(filter)}`, () => analyticsApi.kpis(filter));
  if (!data) return <LoadingCard error={error} />;
  const k = data.totals;
  if (k.shipments === 0) {
    return (
      <Card>
        <EmptyState title={t('analytics.common.noData')} action={<a href="#/app/samples">{t('shipments.trySample')}</a>}>
          {t('analytics.common.noDataText')}
        </EmptyState>
      </Card>
    );
  }
  const perShipment = (m: { shipments: number; findings: number }) => (m.shipments ? m.findings / m.shipments : 0);
  const hours = (h: number | null) => (h === null ? '—' : h >= 48 ? t('analytics.common.days', { value: formatNumber(h / 24, 1) }) : t('analytics.common.hours', { value: formatNumber(h, 1) }));
  const monthColumns: Column<KpiMonth>[] = [
    { key: 'month', header: t('analytics.kpis.columns.month'), cell: (m) => monthLabel(m.month) },
    { key: 'shipments', header: t('analytics.kpis.columns.shipments'), cell: (m) => formatNumber(m.shipments), numeric: true },
    { key: 'clean', header: t('analytics.kpis.columns.clean'), cell: (m) => formatPercent(m.shipments ? m.clean / m.shipments : null, locale), numeric: true },
    { key: 'findings', header: t('analytics.kpis.columns.findings'), cell: (m) => formatNumber(m.findings), numeric: true },
    { key: 'per', header: t('analytics.kpis.columns.perShipment'), cell: (m) => formatNumber(perShipment(m), 2), numeric: true },
  ];
  const summary = data.months.map((m) => `${monthLabel(m.month)} ${formatNumber(perShipment(m), 2)}`).join(', ');
  return (
    <>
      <div className="stat-tiles">
        <StatTile label={t('analytics.kpis.stats.shipments')} value={formatNumber(k.shipments)} />
        <StatTile
          label={t('analytics.kpis.stats.clean')}
          value={formatPercent(k.cleanFirstPass / k.shipments, locale)}
          hint={t('analytics.kpis.stats.cleanHint', { clean: k.cleanFirstPass, total: k.shipments })}
          tone="ok"
        />
        <StatTile label={t('analytics.kpis.stats.perShipment')} value={formatNumber(k.firstPassFindings / k.shipments, 2)} hint={t('analytics.kpis.stats.perShipmentHint')} />
        <StatTile
          label={t('analytics.kpis.stats.open')}
          value={formatNumber(k.openFindings)}
          hint={t('analytics.kpis.stats.openHint', { resolved: k.resolvedFindings, dismissed: k.dismissedFindings })}
          tone={k.openFindings ? 'attention' : 'neutral'}
        />
        <StatTile label={t('analytics.kpis.stats.resolution')} value={<span className="nowrap">{hours(k.medianResolutionHours)}</span>} hint={t('analytics.kpis.stats.resolutionHint')} />
        <StatTile label={t('analytics.kpis.stats.response')} value={<span className="nowrap">{hours(k.medianResponseHours)}</span>} hint={t('analytics.kpis.stats.responseHint', { answered: k.answered, requests: k.requests })} />
      </div>
      <Card title={t('analytics.kpis.overTime')}>
        <MonthChart
          bars={data.months.map((m) => ({ month: m.month, value: perShipment(m), label: formatNumber(perShipment(m), 2), detail: t('analytics.common.shipments', { count: m.shipments }) }))}
          ariaLabel={t('analytics.kpis.overTimeChart', { summary })}
          formatMonth={monthLabel}
          formatValue={(v) => formatNumber(v, 1)}
        />
        <Disclosure summary={t('analytics.common.asTable')}>
          <DataTable columns={monthColumns} rows={data.months} rowKey={(m) => m.month} caption={t('analytics.kpis.overTime')} compact />
        </Disclosure>
      </Card>
      <Card>
        <p className="muted small">{t('analytics.kpis.rateHint')}</p>
        <div className="analytics-grid">
          <GroupTable title={t('analytics.kpis.byRule')} rows={data.byRule} name={(g) => ruleLabel(t, g.key)} limit={20} />
          <GroupTable
            title={t('analytics.kpis.byDocumentType')}
            rows={data.byDocumentType}
            name={(g) => (g.key in DOCUMENT_TYPE_KEY ? t(DOCUMENT_TYPE_KEY[g.key as DocumentType]) : g.key)}
          />
          <GroupTable
            title={t('analytics.kpis.bySupplier')}
            rows={data.bySupplier}
            name={(g) => (g.key === '-' ? <span className="muted">{t('analytics.common.unknown')}</span> : <a href={`#/app/analytics/suppliers/${g.key}`}>{g.label ?? g.key}</a>)}
          />
          <GroupTable title={t('analytics.kpis.byOrigin')} rows={data.byOrigin} name={(g) => (g.key === '-' ? <span className="muted">{t('analytics.common.unknown')}</span> : countryName(g.key, locale))} />
          <GroupTable title={t('analytics.kpis.byRoute')} rows={data.byRoute} name={(g) => (g.key === '-' ? <span className="muted">{t('analytics.common.unknown')}</span> : <span className="mono">{g.key}</span>)} />
        </div>
      </Card>
    </>
  );
}
