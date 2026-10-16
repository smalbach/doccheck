import { analyticsApi, type AnalyticsFilter, type KpiMonth, type SupplierDetail } from '../../api/analytics';
import { BackLink } from '../../components/layout/BackLink';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Disclosure } from '../../components/ui/Disclosure';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { formatPercent } from '../../lib/formatPercent';
import { ruleLabel } from '../../lib/ruleLabel';
import { StatTile } from '../dashboard/StatTile';
import { AnalyticsPage, filterKey } from './AnalyticsPage';
import { MonthChart } from './MonthChart';
import { ScoreFormula } from './ScoreFormula';
import { useMonthLabel } from '../../hooks/useMonthLabel';

type Rule = SupplierDetail['topRules'][number];
type Request = SupplierDetail['requestsList'][number];

/** One supplier: its score and the parts behind it, error rate by month, rules it breaks most, its correction requests. */
export function SupplierPage({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <AnalyticsPage titleKey="analytics.suppliers.title" descriptionKey="analytics.suppliers.description" before={<BackLink href="#/app/analytics/suppliers" label={t('analytics.suppliers.detail.back')} />}>
      {(filter) => <SupplierBody id={id} filter={filter} />}
    </AnalyticsPage>
  );
}

function SupplierBody({ id, filter }: { id: string; filter: AnalyticsFilter }) {
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  const monthLabel = useMonthLabel();
  const { data: s, error } = useQuery(`supplier:${id}:${filterKey(filter)}`, () => analyticsApi.supplier(id, filter));
  if (!s) return <LoadingCard error={error} />;
  const rate = (m: KpiMonth) => (m.shipments ? (m.shipments - m.clean) / m.shipments : 0);
  const monthColumns: Column<KpiMonth>[] = [
    { key: 'month', header: t('analytics.kpis.columns.month'), cell: (m) => monthLabel(m.month) },
    { key: 'shipments', header: t('analytics.kpis.columns.shipments'), cell: (m) => formatNumber(m.shipments), numeric: true },
    { key: 'rate', header: t('analytics.kpis.columns.errorRate'), cell: (m) => formatPercent(rate(m), locale), numeric: true },
    { key: 'findings', header: t('analytics.kpis.columns.findings'), cell: (m) => formatNumber(m.findings), numeric: true },
  ];
  const ruleColumns: Column<Rule>[] = [
    { key: 'rule', header: t('analytics.suppliers.detail.rule'), cell: (r) => <span className="cell-wide">{ruleLabel(t, r.ruleId)}</span> },
    { key: 'findings', header: t('analytics.suppliers.detail.findings'), cell: (r) => formatNumber(r.findings), numeric: true },
    { key: 'shipments', header: t('analytics.suppliers.detail.shipments'), cell: (r) => formatNumber(r.shipments), numeric: true },
  ];
  const requestColumns: Column<Request>[] = [
    { key: 'subject', header: t('analytics.suppliers.detail.subject'), cell: (r) => <a className="cell-wide" href={`#/app/inbox/${r.threadId}`}>{r.subject}</a> },
    { key: 'shipment', header: t('analytics.suppliers.detail.shipment'), cell: (r) => (r.shipmentId ? <a href={`#/app/s/${r.shipmentId}`}>{r.reference ?? r.shipmentId.slice(0, 8)}</a> : '—'), secondary: true },
    { key: 'sent', header: t('analytics.suppliers.detail.sent'), cell: (r) => <span className="nowrap">{r.sentAt ? formatDateTime(r.sentAt) : '—'}</span> },
    { key: 'reply', header: t('analytics.suppliers.detail.replied'), cell: (r) => <span className="nowrap">{r.firstReplyAt ? formatDateTime(r.firstReplyAt) : t('analytics.suppliers.detail.noReply')}</span> },
  ];
  const c = s.score.components;
  return (
    <>
      <Card title={s.name} aside={<a href={`#/app/companies/${s.partyId}`}>{t('analytics.suppliers.detail.company')}</a>}>
        <div className="stat-tiles">
          <StatTile label={t('analytics.suppliers.columns.score')} value={s.score.score ?? '—'} hint={s.rank ? `${t('analytics.suppliers.columns.rank')} ${s.rank}` : t('analytics.suppliers.noScore')} />
          <StatTile label={t('analytics.suppliers.columns.firstPass')} value={formatPercent(c.firstPass, locale)} hint={`${s.cleanFirstPass} / ${s.validatedShipments}`} />
          <StatTile label={t('analytics.suppliers.columns.correction')} value={formatPercent(c.correction, locale)} hint={`${s.correctedFindings} / ${s.requestedFindings}`} />
          <StatTile
            label={t('analytics.suppliers.columns.response')}
            value={<span className="nowrap">{s.medianResponseHours === null ? '—' : t('analytics.common.hours', { value: formatNumber(s.medianResponseHours, 1) })}</span>}
            hint={t('analytics.kpis.stats.responseHint', { answered: s.answered, requests: s.requests })}
          />
        </div>
        {s.months.length > 0 && (
          <>
            <h2 className="section-title">{t('analytics.suppliers.detail.trend')}</h2>
            <MonthChart
              bars={s.months.map((m) => ({ month: m.month, value: rate(m), label: formatPercent(rate(m), locale), detail: t('analytics.common.shipments', { count: m.shipments }) }))}
              ariaLabel={t('analytics.suppliers.detail.trendChart', { summary: s.months.map((m) => `${monthLabel(m.month)} ${formatPercent(rate(m), locale)}`).join(', ') })}
              formatMonth={monthLabel}
              formatValue={(v) => formatPercent(v, locale)}
            />
            <Disclosure summary={t('analytics.common.asTable')}>
              <DataTable columns={monthColumns} rows={s.months} rowKey={(m) => m.month} caption={t('analytics.suppliers.detail.trend')} compact />
            </Disclosure>
          </>
        )}
        <div className="analytics-grid">
          <section>
            <h2 className="section-title">{t('analytics.suppliers.detail.topRules')}</h2>
            {s.topRules.length ? <DataTable columns={ruleColumns} rows={s.topRules} rowKey={(r) => r.ruleId} caption={t('analytics.suppliers.detail.topRules')} compact /> : <p className="muted small">{t('analytics.common.none')}</p>}
          </section>
          <section>
            <h2 className="section-title">{t('analytics.suppliers.detail.requests')}</h2>
            {s.requestsList.length ? (
              <DataTable columns={requestColumns} rows={s.requestsList} rowKey={(r) => r.threadId} caption={t('analytics.suppliers.detail.requests')} compact />
            ) : (
              <p className="muted small">{t('analytics.suppliers.detail.noRequests')}</p>
            )}
          </section>
        </div>
      </Card>
      <Card>
        <ScoreFormula />
      </Card>
    </>
  );
}
