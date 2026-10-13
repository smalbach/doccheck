import type { DocumentType, ExtractedData } from '../api/types';
import { displayValue } from './displayValue';
import { readPath } from './readPath';

export interface ExtractedRow {
  label: string;
  /** Invoice lines: label is the line number, shown as "Line n". */
  isLine?: boolean;
  cells: string[];
}

const list = (data: ExtractedData, key: string): ExtractedData[] => {
  const value = data[key];
  return Array.isArray(value) ? (value as ExtractedData[]) : [];
};

/** The repeated part of a document as table rows: invoice lines, packages, or containers. */
export function buildExtractedRows(type: DocumentType, data: ExtractedData): ExtractedRow[] {
  const at = (row: ExtractedData, path: string) => displayValue(readPath(row, path));
  switch (type) {
    case 'COMMERCIAL_INVOICE':
      return list(data, 'lines').map((l) => ({
        label: at(l, 'lineNo'),
        isLine: true,
        cells: [at(l, 'description'), `${at(l, 'quantity.value')} ${at(l, 'quantity.unit')}`, at(l, 'unitPrice.amount'), at(l, 'lineTotal.amount'), at(l, 'countryOfOrigin')],
      }));
    case 'PACKING_LIST':
      return list(data, 'packages').map((p) => ({
        label: at(p, 'range'),
        cells: [`${at(p, 'count')} ${at(p, 'type')}`, at(p, 'contents.0.description'), at(p, 'contents.0.quantity.value'), at(p, 'grossWeight.kg')],
      }));
    case 'BILL_OF_LADING':
      return list(data, 'containers').map((c) => ({
        label: at(c, 'number'),
        cells: [at(c, 'seal'), at(c, 'type'), at(c, 'packages'), at(c, 'grossWeight.kg')],
      }));
    default:
      return [];
  }
}
