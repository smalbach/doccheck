import { reviewApi } from '../../api/review';
import { useQuery } from '../../hooks/useQuery';
import { useUsage } from '../../hooks/useUsage';
import { useI18n } from '../../i18n/useI18n';
import { StatTile } from './StatTile';

/** The review queue and this month's usage, next to the shipment counters. */
export function WorkloadTiles() {
  const { t } = useI18n();
  const { data: review } = useQuery('review-summary', reviewApi.summary);
  const { data: usage } = useUsage();
  if (!review && !usage) return null;
  const extraction = usage?.meters.find((m) => m.kind === 'extraction');
  return (
    <div className="stat-tiles">
      {review && (
        <StatTile
          label={t('reviewQueue.dashboardTile')}
          value={review.documents}
          href="#/app/review"
          tone={review.documents ? 'attention' : 'ok'}
          hint={t('reviewQueue.dashboardHint', { count: review.fields })}
        />
      )}
      {usage && extraction && (
        <StatTile
          label={t('usage.kinds.extraction')}
          value={extraction.limit === null ? t('usage.unlimited', { used: extraction.used }) : t('usage.used', { used: extraction.used, limit: extraction.limit })}
          href="#/app/usage"
          tone={extraction.state === 'ok' ? 'neutral' : 'attention'}
          hint={t('usage.plan', { plan: usage.plan.name })}
        />
      )}
    </div>
  );
}
