import type { DocumentType, ExtractedData } from '../api/types';
import { EXTRACTED_FIELDS, INVOICE_LINE_FIELDS } from '../constants/extractedFields';
import type { MessageKey } from '../i18n/keys';
import { dotPathToPointer } from './dotPathToPointer';
import { readPath } from './readPath';

export interface CorrectionField {
  /** JSON pointer sent to the API. */
  pointer: string;
  labelKey: MessageKey;
  /** Invoice line number the field belongs to; absent for document fields. */
  line?: string;
  /** The current value as text; "" when absent. */
  initial: string;
  /** The document holds a number here (counts, packages): a numeric entry is sent back as one. */
  numeric: boolean;
}

const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The field at a dot path if it can be corrected: a single value, or an absent one in an existing object. */
function field(data: ExtractedData, path: string, labelKey: MessageKey, line?: string): CorrectionField[] {
  const value = readPath(data, path);
  const parentPath = path.split('.').slice(0, -1).join('.');
  const parent = parentPath ? readPath(data, parentPath) : data;
  if (!isScalar(value) && !(value === undefined && isObject(parent))) return [];
  return [{ pointer: dotPathToPointer(path), labelKey, line, initial: value === undefined ? '' : String(value), numeric: typeof value === 'number' }];
}

/** Values of a document that can be corrected by hand: its key fields and, for an invoice, each line. */
export function buildCorrectionFields(type: DocumentType, data: ExtractedData): CorrectionField[] {
  const fields = (EXTRACTED_FIELDS[type] ?? []).flatMap((f) => field(data, f.path, f.labelKey));
  if (type !== 'COMMERCIAL_INVOICE' || !Array.isArray(data.lines)) return fields;
  const lines = (data.lines as ExtractedData[]).flatMap((l, i) =>
    INVOICE_LINE_FIELDS.flatMap((f) => field(data, `lines.${i}.${f.path}`, f.labelKey, String(l.lineNo ?? i + 1))),
  );
  return [...fields, ...lines];
}
