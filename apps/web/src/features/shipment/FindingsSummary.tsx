import type { Finding } from '../../api/types';
import { countBySeverity } from '../../lib/countBySeverity';
import { useI18n } from '../../i18n/useI18n';

/** "3 findings: 1 high, 2 medium". */
export function FindingsSummary({ findings }: { findings: readonly Pick<Finding, 'severity'>[] }) {
  const { t } = useI18n();
  const counts = countBySeverity(findings);
  return (
    <p className="findings-summary">
      <strong>{t('shipment.findings.summary', { count: findings.length })}</strong>
      {counts.map((c) => (
        <span key={c.severity} className={`severity-count severity-${c.severity}`}>
          {c.count} {t(`severity.${c.severity}`).toLowerCase()}
        </span>
      ))}
    </p>
  );
}
