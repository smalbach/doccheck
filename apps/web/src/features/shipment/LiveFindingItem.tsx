import type { RuleDefinition } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import { findingAnchorId, type LiveFinding } from '../../lib/liveFindings';

export interface LiveFindingItemProps {
  finding: LiveFinding;
  rule?: RuleDefinition;
  /** Shown after the run was saved: no entrance animation. */
  settled?: boolean;
}

/**
 * A finding of the running validation, as the events built it: it slides in when found, its regulation
 * line fades in during the citations, and the agent's effect marks it (dismissed: faded and struck
 * through, with the agent's reason). Same look as the stored FindingCard, so saving swaps them quietly.
 */
export function LiveFindingItem({ finding, rule, settled = false }: LiveFindingItemProps) {
  const { t } = useI18n();
  const dismissed = finding.effect === 'dismissed';
  const titleId = `live-${findingAnchorId(finding.id)}`;
  return (
    <li id={findingAnchorId(finding.id)} tabIndex={-1} className="finding-item">
      <article className={cx('finding', `finding-${finding.severity}`, !settled && 'finding-live', finding.effect && `finding-${finding.effect}`)} aria-labelledby={titleId}>
        <header>
          <span className={`severity severity-${finding.severity}`}>{t(`severity.${finding.severity}`)}</span>
          <h3 className="rule-id" id={titleId}>
            {finding.ruleId}
          </h3>
          {rule && (
            <span className="rule-title" lang="en">
              {rule.title}
            </span>
          )}
          {finding.effect && <Tag tone={dismissed ? 'neutral' : 'accent'}>{t(`progress.live.effects.${finding.effect}`)}</Tag>}
        </header>
        {dismissed ? (
          <p lang="en">
            <del>{finding.message}</del>
          </p>
        ) : (
          <p lang="en">{finding.message}</p>
        )}
        {finding.rationale && (
          <p className="rationale finding-reveal">
            <strong>{t('shipment.findings.agentLabel')}</strong> <span lang="en">{finding.rationale}</span>
          </p>
        )}
        {finding.regulation && (
          <p className="finding-cite finding-reveal">
            <strong>{t('progress.live.regulation')}</strong> <span lang="en">{finding.regulation}</span>
          </p>
        )}
      </article>
    </li>
  );
}
