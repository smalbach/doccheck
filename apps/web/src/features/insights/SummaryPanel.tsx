import type { Destination } from '../../api/types';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { EmptyState } from '../../components/ui/EmptyState';
import type { GoodsFilterState } from '../../constants/insights';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { api } from '../../api/client';
import { StatTile } from '../dashboard/StatTile';
import { HsBreakdown } from './HsBreakdown';
import { MoneyList } from './MoneyList';
import { OriginBreakdown } from './OriginBreakdown';

export interface SummaryPanelProps {
  destination?: Destination;
  onShowGoods: (filter: Partial<GoodsFilterState>) => void;
}

/** Totals over every shipment's extracted documents, and the goods grouped by origin and HS code. */
export function SummaryPanel({ destination, onShowGoods }: SummaryPanelProps) {
  const { t, formatNumber } = useI18n();
  const { data, error } = useQuery(`summary:${destination ?? ''}`, () => api.insightsSummary(destination));
  if (!data) return <LoadingCard error={error} />;
  if (data.shipments === 0) {
    return (
      <EmptyState title={t('insights.emptyTitle')} action={<a href="#/app/samples">{t('shipments.trySample')}</a>}>
        {t('insights.emptyText')}
      </EmptyState>
    );
  }
  return (
    <div className="insights-summary">
      <div className="stat-tiles">
        <StatTile label={t('insights.stats.shipments')} value={data.shipments} hint={t('insights.stats.lines', { count: data.invoiceLines })} />
        <StatTile label={t('insights.stats.value')} value={<span className="stat-tile-compact"><MoneyList totals={data.valueByCurrency} stacked /></span>} hint={t('insights.stats.valueHint')} />
        <StatTile label={t('insights.stats.gross')} value={<span className="stat-tile-compact nowrap">{formatNumber(data.grossKg, 1)} kg</span>} hint={t('insights.stats.net', { kg: formatNumber(data.netKg, 1) })} />
        <StatTile label={t('insights.stats.packages')} value={formatNumber(data.packages)} hint={t('insights.stats.containers', { count: data.containers })} />
      </div>
      {data.quantityByUnit.length > 0 && (
        <p className="muted small">
          {t('insights.quantities')}: {data.quantityByUnit.map((q) => `${formatNumber(q.amount)} ${q.key}`).join(' · ')}
        </p>
      )}
      <div className="insights-breakdowns">
        <OriginBreakdown rows={data.byOrigin} onShow={(origin) => onShowGoods({ origin })} />
        <HsBreakdown rows={data.byHsCode} onShow={(hs) => onShowGoods({ hs })} />
      </div>
    </div>
  );
}
