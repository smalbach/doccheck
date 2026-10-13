import type { FindingReview } from '../../api/types';
import { Disclosure } from '../../components/ui/Disclosure';
import { useI18n } from '../../i18n/useI18n';

/** Every decision about a finding, newest first, with who made it and why. */
export function FindingHistory({ history }: { history: readonly FindingReview[] }) {
  const { t, formatDateTime } = useI18n();
  if (history.length === 0) return null;
  return (
    <Disclosure summary={t('review.history', { count: history.length })}>
      <ol className="review-history">
        {history.map((h, i) => (
          <li key={`${h.at}-${i}`}>
            <span className="small">{t('review.entry', { status: t(`review.status.${h.status}`), user: h.userName ?? t('review.someone'), date: formatDateTime(h.at) })}</span>
            {h.note && <span className="block">{h.note}</span>}
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
