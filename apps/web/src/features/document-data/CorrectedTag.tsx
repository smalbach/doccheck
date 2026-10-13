import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { displayValue } from '../../lib/displayValue';

/** Marks a value corrected by hand, with what the model had read. */
export function CorrectedTag({ modelValue }: { modelValue: unknown }) {
  const { t } = useI18n();
  return (
    <span className="corrected">
      <Tag tone="accent">{t('extracted.corrected')}</Tag> <span className="muted small">{t('extracted.modelRead', { value: displayValue(modelValue) })}</span>
    </span>
  );
}
