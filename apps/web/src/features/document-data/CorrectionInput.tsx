import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import type { CorrectionField } from '../../lib/buildCorrectionFields';
import { CorrectedTag } from './CorrectedTag';

export interface CorrectionInputProps {
  field: CorrectionField;
  value: string;
  /** What the API said about this value on the last save. */
  error?: string;
  /** Already corrected by hand: what the model read. */
  corrected: boolean;
  modelValue?: unknown;
  onChange: (value: string) => void;
}

/** One editable value of the extracted document. */
export function CorrectionInput({ field, value, error, corrected, modelValue, onChange }: CorrectionInputProps) {
  const { t } = useI18n();
  return (
    <Field label={t(field.labelKey)}>
      {(id) => (
        <>
          <TextInput
            id={id}
            value={value}
            inputMode={field.numeric ? 'numeric' : undefined}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          {error && (
            <span id={`${id}-error`} className="error small" lang="en">
              {error}
            </span>
          )}
          {corrected && <CorrectedTag modelValue={modelValue} />}
        </>
      )}
    </Field>
  );
}
