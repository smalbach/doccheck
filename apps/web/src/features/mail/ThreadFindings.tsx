import type { Validation } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { reviewStatus, ruleGuideKey } from '../../lib/findingReview';

export interface ThreadFindingsProps {
  fingerprints: readonly string[];
  validation?: Validation;
}

/** The findings a request was about, as the shipment's latest validation sees them now. */
export function ThreadFindings({ fingerprints, validation }: ThreadFindingsProps) {
  const { t } = useI18n();
  const current = new Map((validation?.findings ?? []).map((f) => [f.fingerprint, f]));
  return (
    <Card title={t('mail.findings')}>
      <p className="muted small">{t('mail.findingsHint')}</p>
      <ul className="resolved-list">
        {fingerprints.map((fp) => {
          const f = current.get(fp);
          const problem = f && ruleGuideKey(f.ruleId, 'problem');
          return (
            <li key={fp}>
              {f ? (
                <>
                  <span className={`severity severity-${f.severity}`}>{t(`severity.${f.severity}`)}</span> <strong>{f.ruleId}</strong> {problem ? t(problem) : <span lang="en">{f.message}</span>}{' '}
                  <Tag>{t(`review.status.${reviewStatus(f)}`)}</Tag>
                </>
              ) : (
                validation && <Tag tone="ok">{t('mail.findingGone')}</Tag>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
