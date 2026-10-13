import type { CorrectionField } from './buildCorrectionFields';

export interface CorrectionGroup {
  /** Invoice line number; absent for the document's own fields. */
  line?: string;
  fields: CorrectionField[];
}

/** Document fields first, then one group per invoice line, in order. */
export function groupCorrectionFields(fields: readonly CorrectionField[]): CorrectionGroup[] {
  const groups: CorrectionGroup[] = [];
  for (const f of fields) {
    const last = groups[groups.length - 1];
    if (last && last.line === f.line) last.fields.push(f);
    else groups.push({ line: f.line, fields: [f] });
  }
  return groups;
}
