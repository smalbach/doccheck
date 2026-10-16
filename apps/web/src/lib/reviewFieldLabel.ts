import type { DocumentType } from '../api/types';
import { EXTRACTED_FIELDS } from '../constants/extractedFields';
import type { MessageKey, MessageVars } from '../i18n/keys';

const ITEMS = new Set(['lines', 'packages', 'containers']);
const NAMES = new Set(['description', 'quantity', 'unitPrice', 'lineTotal', 'countryOfOrigin', 'hsCode', 'count', 'netWeight', 'grossWeight', 'number', 'seal', 'packages']);

/**
 * A readable name for a field of the review screen: "/netWeight/kg" -> "Net weight",
 * "/lines/2/quantity/value" -> "Line 3 · quantity". Unknown fields fall back to their path.
 */
export function reviewFieldLabel(path: string, type: DocumentType, t: (key: MessageKey, vars?: MessageVars) => string): string {
  const segments = path.split('/').slice(1);
  const spec = EXTRACTED_FIELDS[type]?.find((f) => f.path === segments.join('.'));
  if (spec) return t(spec.labelKey);
  const [list, index, name] = segments;
  if (list && ITEMS.has(list) && index && /^\d+$/.test(index)) {
    const item = t(`reviewQueue.items.${list}` as MessageKey, { n: Number(index) + 1 });
    return name && NAMES.has(name) ? `${item} · ${t(`reviewQueue.fieldNames.${name}` as MessageKey)}` : `${item} · ${segments.slice(2).join('.')}`;
  }
  return segments.join('.');
}
