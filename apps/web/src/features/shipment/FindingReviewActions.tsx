import { useState, type ReactNode } from 'react';
import type { ReviewStatus, ValidationFinding } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { reviewStatus } from '../../lib/findingReview';
import { ReviewNoteDialog } from './ReviewNoteDialog';

export interface FindingReviewActionsProps {
  finding: ValidationFinding;
  busy: boolean;
  onReview: (status: ReviewStatus, note?: string) => Promise<void>;
  /** "Write to the supplier…": the request dialog with this finding picked. */
  request?: ReactNode;
}

/** What can be decided about a finding from where it stands; closing it asks for a reason. */
export function FindingReviewActions({ finding, busy, onReview, request }: FindingReviewActionsProps) {
  const { t } = useI18n();
  const [asking, setAsking] = useState<'accepted' | 'false_positive'>();
  const status = reviewStatus(finding);
  const closed = status === 'accepted' || status === 'false_positive';
  return (
    <div className="review-actions" role="group" aria-label={t('review.actions.label', { rule: finding.ruleId })}>
      {status === 'open' && (
        <Button size="sm" disabled={busy} onClick={() => void onReview('waiting_supplier')}>
          {t('review.actions.waiting')}
        </Button>
      )}
      {!closed && (
        <>
          {request}
          <Button size="sm" disabled={busy} onClick={() => setAsking('accepted')}>
            {t('review.actions.accept')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setAsking('false_positive')}>
            {t('review.actions.falsePositive')}
          </Button>
        </>
      )}
      {status !== 'open' && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onReview('open')}>
          {t('review.actions.reopen')}
        </Button>
      )}
      {asking && <ReviewNoteDialog status={asking} ruleId={finding.ruleId} onClose={() => setAsking(undefined)} onConfirm={(note) => onReview(asking, note)} />}
    </div>
  );
}
