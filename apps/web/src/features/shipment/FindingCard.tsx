import { ClockIcon } from '@radix-ui/react-icons';
import type { ReactNode } from 'react';
import type { ReviewStatus, RuleDefinition, ShipmentDocument, ValidationFinding } from '../../api/types';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { reviewStatus, ruleGuideKey } from '../../lib/findingReview';
import type { ViewerTarget } from '../pdf/types';
import { EvidenceItem } from './EvidenceItem';
import { FindingHistory } from './FindingHistory';
import { FindingReviewActions } from './FindingReviewActions';
import { RegulationQuote } from './RegulationQuote';

export interface FindingCardProps {
  finding: ValidationFinding;
  rule?: RuleDefinition;
  documents: ReadonlyMap<string, ShipmentDocument>;
  onOpen: (target: ViewerTarget) => void;
  /** Decisions and corrections can be made (the latest run, outside the demo). */
  review?: {
    busy: boolean;
    onReview: (status: ReviewStatus, note?: string) => Promise<void>;
    onCorrect: (doc: ShipmentDocument, field: string) => void;
    /** Opens the request to the supplier with this finding picked. */
    request?: ReactNode;
  };
}

export function FindingCard({ finding, rule, documents, onOpen, review }: FindingCardProps) {
  const { t, formatDateTime } = useI18n();
  const status = reviewStatus(finding);
  const waiting = status === 'waiting_supplier' && finding.review;
  const problem = ruleGuideKey(finding.ruleId, 'problem');
  const action = ruleGuideKey(finding.ruleId, 'action');
  return (
    <article className={`finding finding-${finding.severity} review-${status}`} aria-labelledby={`finding-${finding.id}`}>
      {waiting && (
        <p className="waiting-flag">
          <ClockIcon aria-hidden />
          <span>
            {t('review.waitingFlag', { date: formatDateTime(waiting.at) })}
            {waiting.userName && <span className="waiting-by"> · {t('review.waitingBy', { name: waiting.userName })}</span>}
          </span>
        </p>
      )}
      <header>
        <span className={`severity severity-${finding.severity}`}>{t(`severity.${finding.severity}`)}</span>
        <h3 className="rule-id" id={`finding-${finding.id}`}>
          {finding.ruleId}
        </h3>
        {rule && (
          <span className="rule-title" lang="en">
            {rule.title}
          </span>
        )}
        {finding.decidedBy === 'AGENT' && <Tag tone="accent">{t('shipment.findings.agent')}</Tag>}
        {finding.isNew && (
          <span title={t('review.newHint')}>
            <Tag tone="accent">{t('review.newTag')}</Tag>
          </span>
        )}
        {!waiting && (status !== 'open' || finding.review) && <Tag tone={status === 'open' ? 'neutral' : 'ok'}>{t(`review.status.${status}`)}</Tag>}
      </header>
      {problem && <p className="finding-problem">{t(problem)}</p>}
      <p lang="en" className={problem ? 'muted small' : undefined}>
        {finding.message}
      </p>
      <ul className="evidence">
        {finding.evidence.map((e, i) => (
          <EvidenceItem key={`${e.documentId}-${e.field}-${i}`} evidence={e} doc={documents.get(e.documentId)} onOpen={onOpen} onCorrect={review?.onCorrect} />
        ))}
      </ul>
      {finding.agentRationale && (
        <p className="rationale">
          <strong>{t('shipment.findings.agentLabel')}</strong> <span lang="en">{finding.agentRationale}</span>
        </p>
      )}
      {action ? (
        <p className="fix">
          <strong>{t('review.whatToDo')}:</strong> {t(action)}
        </p>
      ) : (
        finding.suggestedFix && (
          <p className="fix" lang="en">
            {finding.suggestedFix}
          </p>
        )
      )}
      {finding.regulation && <RegulationQuote regulation={finding.regulation} />}
      {finding.review?.note && <p className="review-note">“{finding.review.note}”</p>}
      {review && finding.fingerprint && <FindingReviewActions finding={finding} busy={review.busy} onReview={review.onReview} request={review.request} />}
      <FindingHistory history={finding.history ?? []} />
    </article>
  );
}
