import { useI18n } from '../../i18n/useI18n';
import { formatPercent } from '../../lib/formatPercent';

/** A share as text with a thin bar behind it: the bar only repeats the number, so it is hidden from screen readers. */
export function RateCell({ part, total }: { part: number; total: number }) {
  const { locale } = useI18n();
  const share = total > 0 ? part / total : null;
  return (
    <span className="rate-cell">
      <span className="rate-bar" aria-hidden>
        <span className="rate-bar-fill" style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
      </span>
      <span className="rate-value">{formatPercent(share, locale)}</span>
    </span>
  );
}
