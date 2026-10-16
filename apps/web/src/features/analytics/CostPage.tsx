import { useState } from 'react';
import { analyticsApi, type AnalyticsFilter, type CostItem, type CostReport, type Money } from '../../api/analytics';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { DESTINATIONS } from '../../constants/destinations';
import { EmptyState } from '../../components/ui/EmptyState';
import { Tag } from '../../components/ui/Tag';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useOrg } from '../team/useOrg';
import { StatTile } from '../dashboard/StatTile';
import { AnalyticsPage, filterKey } from './AnalyticsPage';
import { CostAssumptionsForm } from './CostAssumptionsForm';

/** Estimated exposure avoided by findings corrected before arrival, with the assumptions always shown and editable. */
export function CostPage() {
  return (
    <AnalyticsPage titleKey="analytics.cost.title" descriptionKey="analytics.cost.description">
      {(filter) => <CostBody filter={filter} />}
    </AnalyticsPage>
  );
}

function CostBody({ filter }: { filter: AnalyticsFilter }) {
  const { t, formatMoney, formatNumber } = useI18n();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string>();
  // The assumptions are the organization's: owners and admins change them, everyone else reads them.
  const canEdit = useOrg().can('org.settings');
  const { data, error } = useQuery(`cost:${filterKey(filter)}:${version}`, () => analyticsApi.cost(filter));
  if (!data) return <LoadingCard error={error} />;
  const money = (totals: readonly Money[]) =>
    totals.length ? (
      <span className="stat-tile-compact">
        {totals.map((m) => (
          <span key={m.currency} className="block nowrap">
            {formatMoney(m.amount, m.currency)}
          </span>
        ))}
      </span>
    ) : (
      formatNumber(0)
    );
  const reset = async () => {
    try {
      await analyticsApi.resetCost();
      setNotice(t('analytics.cost.assumptions.saved'));
      setVersion((v) => v + 1);
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };
  const columns: Column<CostItem>[] = [
    { key: 'shipment', header: t('analytics.cost.columns.shipment'), cell: (i) => <a className="nowrap" href={`#/app/s/${i.shipmentId}`}>{i.reference ?? i.shipmentId.slice(0, 8)}</a> },
    { key: 'item', header: t('analytics.cost.columns.item'), cell: (i) => <span className="cell-wide">{itemLabel(i, data, t)}</span> },
    { key: 'rules', header: t('analytics.cost.columns.rules'), cell: (i) => <span className="mono">{i.ruleIds.join(', ')}</span>, secondary: true },
    { key: 'arrival', header: t('analytics.cost.columns.arrival'), cell: (i) => <span className="nowrap">{i.arrival}</span>, secondary: true },
    { key: 'outcome', header: t('analytics.cost.columns.outcome'), cell: (i) => <Tag tone={i.outcome === 'avoided' ? 'ok' : i.outcome === 'exposed' ? 'accent' : 'neutral'}>{t(`analytics.cost.outcome.${i.outcome}`)}</Tag> },
    { key: 'amount', header: t('analytics.cost.columns.amount'), cell: (i) => <span className="nowrap">{formatMoney(i.amount, i.currency)}</span>, numeric: true },
  ];
  return (
    <>
      <Banner tone="info">
        <strong>{t('analytics.common.estimate')}.</strong> {t('analytics.cost.banner')}
      </Banner>
      <div className="stat-tiles">
        <StatTile label={t('analytics.cost.stats.avoided')} value={money(data.totals.avoided)} hint={t('analytics.cost.stats.avoidedHint')} tone="ok" />
        <StatTile label={t('analytics.cost.stats.late')} value={money(data.totals.late)} hint={t('analytics.cost.stats.lateHint')} />
        <StatTile label={t('analytics.cost.stats.exposed')} value={money(data.totals.exposed)} hint={t('analytics.cost.stats.exposedHint')} tone={data.totals.exposed.length ? 'attention' : 'neutral'} />
      </div>
      <Card
        title={t('analytics.cost.assumptions.title')}
        aside={
          !editing &&
          canEdit && (
            <div className="filters-right">
              <Button size="sm" onClick={() => setEditing(true)}>
                {t('analytics.cost.assumptions.edit')}
              </Button>
              {!data.defaults && (
                <Button size="sm" variant="ghost" onClick={() => void reset()}>
                  {t('analytics.cost.assumptions.reset')}
                </Button>
              )}
            </div>
          )
        }
      >
        {notice && <Banner tone="ok">{notice}</Banner>}
        <p className="muted small">{data.defaults ? t('analytics.cost.assumptions.defaults') : t('analytics.cost.assumptions.custom')}</p>
        {editing ? (
          <CostAssumptionsForm
            initial={data.assumptions}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              setNotice(t('analytics.cost.assumptions.saved'));
              setVersion((v) => v + 1);
            }}
          />
        ) : (
          <AssumptionsTable data={data} />
        )}
        <p className="muted small">{t('analytics.cost.assumptions.how')}</p>
        {data.unmapped.length > 0 && <p className="muted small">{t('analytics.cost.unmapped', { rules: data.unmapped.join(', ') })}</p>}
      </Card>
      <Card title={t('analytics.cost.items')}>
        {data.items.length === 0 ? (
          <EmptyState title={t('analytics.common.noData')}>{t('analytics.common.noDataText')}</EmptyState>
        ) : (
          <DataTable columns={columns} rows={data.items} rowKey={(i) => `${i.shipmentId}:${i.item}`} caption={t('analytics.cost.itemsCaption')} compact />
        )}
      </Card>
    </>
  );
}

function itemLabel(i: CostItem, data: CostReport, t: ReturnType<typeof useI18n>['t']): string {
  if (i.item === 'delay') return t('analytics.cost.delayItem', { days: data.assumptions.delay.days });
  return data.assumptions.penalties.find((p) => p.id === i.item)?.label ?? i.label;
}

function AssumptionsTable({ data }: { data: CostReport }) {
  const { t, formatMoney, formatNumber } = useI18n();
  const a = data.assumptions;
  type P = CostReport['assumptions']['penalties'][number];
  const columns: Column<P>[] = [
    { key: 'dest', header: t('analytics.cost.assumptions.destination'), cell: (p) => p.destination },
    {
      key: 'label',
      header: t('analytics.cost.assumptions.label'),
      cell: (p) => (
        <div className="cell-wide">
          {p.label}
          <span className="muted small block">
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.reference}
              </a>
            ) : (
              p.reference
            )}
          </span>
        </div>
      ),
    },
    { key: 'rules', header: t('analytics.cost.columns.rules'), cell: (p) => <span className="mono small">{p.ruleIds.join(', ')}</span>, secondary: true },
    { key: 'amount', header: t('analytics.cost.assumptions.amount'), cell: (p) => <span className="nowrap">{formatMoney(p.amount, p.currency)}</span>, numeric: true },
  ];
  return (
    <>
      <DataTable columns={columns} rows={a.penalties} rowKey={(p) => p.id} caption={t('analytics.cost.assumptions.penaltyCaption')} compact />
      <dl className="entity-facts cost-facts">
        <div>
          <dt className="muted small">{t('analytics.cost.assumptions.delayDays')}</dt>
          <dd>{formatNumber(a.delay.days)}</dd>
        </div>
        <div>
          <dt className="muted small">{t('analytics.cost.assumptions.delaySeverities')}</dt>
          <dd>{a.delay.severities.map((s) => t(`severity.${s}`)).join(', ') || '—'}</dd>
        </div>
        {DESTINATIONS.map((d) => {
          const rate = a.delay.perDay[d];
          return (
            rate && (
              <div key={d}>
                <dt className="muted small">{t('analytics.cost.assumptions.perDay', { destination: d })}</dt>
                <dd>{formatMoney(rate.amount, rate.currency)}</dd>
              </div>
            )
          );
        })}
        <div>
          <dt className="muted small">{t('analytics.cost.assumptions.transit')}</dt>
          <dd>
            {(['SEA', 'AIR', 'ROAD'] as const).map((m) => `${t(`transportModes.${m}`)} ${a.transitDays[m]}`).join(' · ')}
          </dd>
        </div>
      </dl>
    </>
  );
}
