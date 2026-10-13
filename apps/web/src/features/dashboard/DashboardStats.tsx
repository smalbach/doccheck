import { useI18n } from '../../i18n/useI18n';
import type { ShipmentTotals } from '../../lib/summarizeShipments';
import { StatTile } from './StatTile';

export function DashboardStats({ totals }: { totals: ShipmentTotals }) {
  const { t } = useI18n();
  return (
    <div className="stat-tiles">
      <StatTile label={t('dashboard.stats.shipments')} value={totals.total} href="#/app/shipments" />
      <StatTile label={t('dashboard.stats.inProgress')} value={totals.inProgress} href="#/app/shipments" hint={t('dashboard.stats.inProgressHint')} />
      <StatTile
        label={t('dashboard.stats.attention')}
        value={totals.attention}
        href="#/app/shipments"
        tone={totals.attention ? 'attention' : 'neutral'}
        hint={t('dashboard.stats.attentionHint', { count: totals.findings })}
      />
      <StatTile label={t('dashboard.stats.clean')} value={totals.clean} href="#/app/shipments" tone="ok" hint={t('dashboard.stats.cleanHint')} />
    </div>
  );
}
