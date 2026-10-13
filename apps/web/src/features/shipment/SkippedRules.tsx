import type { SkippedRule } from '../../api/types';
import { DOCUMENT_TYPE_KEY } from '../../constants/documentTypes';
import { useI18n } from '../../i18n/useI18n';

export function SkippedRules({ skipped }: { skipped: readonly SkippedRule[] }) {
  const { t } = useI18n();
  if (skipped.length === 0) return null;
  return (
    <p className="muted small">
      {t('shipment.notChecked', {
        list: skipped.map((s) => t('shipment.needs', { rule: s.ruleId, documents: s.missing.map((m) => t(DOCUMENT_TYPE_KEY[m])).join(', ') })).join('; '),
      })}
    </p>
  );
}
