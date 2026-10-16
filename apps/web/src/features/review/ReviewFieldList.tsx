import type { ReviewField } from '../../api/review';
import type { DocumentType } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { cx } from '../../lib/cx';
import { reviewFieldLabel } from '../../lib/reviewFieldLabel';
import { ConfidenceTag } from './ConfidenceTag';

export interface ReviewFieldListProps {
  fields: ReviewField[];
  documentType: DocumentType;
  selected: number;
  onSelect: (index: number) => void;
}

/** The document's scored values, least sure first; the selected one is outlined on the PDF. */
export function ReviewFieldList({ fields, documentType, selected, onSelect }: ReviewFieldListProps) {
  const { t } = useI18n();
  return (
    <ol className="review-fields" aria-label={t('reviewQueue.fieldsLabel')}>
      {fields.map((f, i) => {
        const state = f.review ? t(f.review.status === 'accepted' ? 'reviewQueue.accepted' : 'reviewQueue.corrected') : f.low ? t('reviewQueue.pending') : t('reviewQueue.sure');
        return (
          <li key={f.path}>
            <button
              type="button"
              id={`review-field-${i}`}
              className={cx('review-field', i === selected && 'review-field-selected', f.low && !f.review && 'review-field-pending')}
              aria-current={i === selected ? 'true' : undefined}
              onClick={() => onSelect(i)}
            >
              <span className="review-field-name">{reviewFieldLabel(f.path, documentType, t)}</span>
              <span className="review-field-value">{f.value === null ? <em>{t('reviewQueue.empty')}</em> : String(f.value)}</span>
              <span className="review-field-meta">
                <ConfidenceTag confidence={f.confidence} low={f.low} />
                <span className="muted small">{state}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
