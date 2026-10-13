import type { DataChange } from '../api/types';
import type { CorrectionField } from './buildCorrectionFields';

const NUMBER = /^-?\d+(\.\d+)?$/;

/** The values edited in the form as changes for the API: only those that differ; an emptied field is removed. */
export function correctionChanges(fields: readonly CorrectionField[], values: Readonly<Record<string, string>>): DataChange[] {
  return fields.flatMap((f): DataChange[] => {
    const text = (values[f.pointer] ?? f.initial).trim();
    if (text === f.initial.trim()) return [];
    if (text === '') return [{ path: f.pointer, value: null }];
    return [{ path: f.pointer, value: f.numeric && NUMBER.test(text) ? Number(text) : text }];
  });
}
