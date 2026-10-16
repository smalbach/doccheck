import type { Meter } from '../../api/usage';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';

/** One count against its limit: the numbers, a bar (decoration: the text says it all) and the state. */
export function UsageMeter({ meter }: { meter: Meter }) {
  const { t } = useI18n();
  const width = meter.limit === null ? 0 : meter.limit === 0 ? 100 : Math.min(100, Math.round((meter.used * 100) / meter.limit));
  return (
    <div className={cx('usage-meter', `usage-meter-${meter.state}`)}>
      <div className="usage-meter-head">
        <strong>{t(`usage.kinds.${meter.kind}`)}</strong>
        <span>{meter.limit === null ? t('usage.unlimited', { used: meter.used }) : t('usage.used', { used: meter.used, limit: meter.limit })}</span>
      </div>
      {meter.limit !== null && (
        <div className="usage-bar" aria-hidden>
          <span style={{ width: `${width}%` }} />
        </div>
      )}
      <p className="muted small">
        {t(`usage.states.${meter.state}`)}
        {meter.remaining !== null && meter.state !== 'blocked' && ` · ${t('usage.remaining', { count: meter.remaining })}`}
      </p>
    </div>
  );
}
