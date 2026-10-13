import type { DocumentType, ExtractedData } from '../../api/types';
import { EXTRACTED_FIELDS } from '../../constants/extractedFields';
import { displayValue } from '../../lib/displayValue';
import { readPath } from '../../lib/readPath';

export function ExtractedFields({ type, data }: { type: DocumentType; data: ExtractedData }) {
  const fields = EXTRACTED_FIELDS[type] ?? [];
  return (
    <dl className="fields">
      {fields.map((f) => (
        <div key={f.path}>
          <dt>{f.label}</dt>
          <dd>{displayValue(readPath(data, f.path))}</dd>
        </div>
      ))}
    </dl>
  );
}
