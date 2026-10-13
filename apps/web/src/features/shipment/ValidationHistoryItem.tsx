import type { ValidationSummary } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Tag } from '../../components/ui/Tag';
import { SEVERITY_ORDER } from '../../constants/severity';
import { useI18n } from '../../i18n/useI18n';

export interface ValidationHistoryItemProps {
  run: ValidationSummary;
  latest: boolean;
  shown: boolean;
  loading: boolean;
  onShow: () => void;
}

export function ValidationHistoryItem({ run, latest, shown, loading, onShow }: ValidationHistoryItemProps) {
  const { t, formatDateTime } = useI18n();
  const when = formatDateTime(run.createdAt);
  return (
    <li className="history-item" aria-current={shown ? 'true' : undefined}>
      <div className="history-main">
        <span className="history-when">{when}</span>
        {latest && <Tag tone="accent">{t('shipment.history.latest')}</Tag>}
        {run.destination && <Tag>{run.destination}</Tag>}
      </div>
      <div className="history-counts small">
        {run.findings === 0 ? (
          <span className="muted">{t('shipment.history.clean', { count: run.ran })}</span>
        ) : (
          <>
            <span>{t('shipment.findings.summary', { count: run.findings })}</span>
            {SEVERITY_ORDER.filter((s) => run.bySeverity[s]).map((s) => (
              <span key={s} className={`severity-count severity-${s}`}>
                {run.bySeverity[s]} {t(`severity.${s}`).toLowerCase()}
              </span>
            ))}
          </>
        )}
      </div>
      {shown ? (
        <span className="muted small">{t('shipment.history.shown')}</span>
      ) : (
        <Button size="sm" variant="link" onClick={onShow} disabled={loading} aria-label={t('shipment.history.showLabel', { date: when })}>
          {loading ? t('common.loading') : t('shipment.history.show')}
        </Button>
      )}
    </li>
  );
}
