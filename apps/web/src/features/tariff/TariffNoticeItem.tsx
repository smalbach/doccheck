import type { TariffNotice } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { RegulationQuote } from '../shipment/RegulationQuote';

/** One P1 or E1 notice: which agency or export list, for which lines, what to prepare, and the source. */
export function TariffNoticeItem({ notice }: { notice: TariffNotice }) {
  const { t } = useI18n();
  return (
    <li className="tariff-notice">
      <span className={`severity severity-${notice.severity}`}>{t(`severity.${notice.severity}`)}</span> <strong>{notice.ruleId}</strong>{' '}
      <span lang="en">{notice.message}</span>
      {notice.suggestedFix && (
        <div className="muted small" lang="en">
          {notice.suggestedFix}
        </div>
      )}
      {notice.regulation && <RegulationQuote regulation={notice.regulation} />}
    </li>
  );
}
