import type { DocumentType, ExtractedData } from '../../api/types';
import { EXTRACTED_FIELDS } from '../../constants/extractedFields';
import { useI18n } from '../../i18n/useI18n';
import { displayValue } from '../../lib/displayValue';
import { dotPathToPointer } from '../../lib/dotPathToPointer';
import { readPath } from '../../lib/readPath';
import { CorrectedTag } from './CorrectedTag';

export interface ExtractedFieldsProps {
  type: DocumentType;
  data: ExtractedData;
  /** Values corrected by hand: pointer → what the model read. */
  corrected: ReadonlyMap<string, unknown>;
}

export function ExtractedFields({ type, data, corrected }: ExtractedFieldsProps) {
  const { t } = useI18n();
  const fields = EXTRACTED_FIELDS[type] ?? [];
  return (
    <dl className="fields">
      {fields.map((f) => {
        const pointer = dotPathToPointer(f.path);
        return (
          <div key={f.path}>
            <dt>{t(f.labelKey)}</dt>
            <dd>
              {displayValue(readPath(data, f.path))}
              {corrected.has(pointer) && <CorrectedTag modelValue={corrected.get(pointer)} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
