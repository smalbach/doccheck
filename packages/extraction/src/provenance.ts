import type { SourceRef } from '@doccheck/schemas';
import type { PdfText } from './pdf-text';

/** Ways a canonical value may be printed: "48600.00" -> "48,600.00", "48600", "48,600". */
function printedForms(value: string): string[] {
  const forms = new Set([value]);
  const m = value.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (m) {
    const grouped = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const frac = m[3];
    forms.add(`${m[1]}${grouped}${frac ? `.${frac}` : ''}`);
    if (!frac || /^0+$/.test(frac)) {
      forms.add(`${m[1]}${m[2]}`);
      forms.add(`${m[1]}${grouped}`);
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').toUpperCase();

/**
 * First line of the document that prints `value`, as a SourceRef. Numbers match on token
 * boundaries so "120" does not match inside "1200". Returns undefined when the value is not printed.
 */
export function findSource(pdf: PdfText, documentId: string, value: string, hint?: RegExp): SourceRef | undefined {
  if (!value) return undefined;
  const forms = printedForms(value).map(norm);
  const numeric = /^-?[\d.,]+$/.test(value);
  const candidates = pdf.lines.filter((line) => {
    const text = norm(line.text);
    return forms.some((f) => {
      // Every occurrence: "5" must skip the 5 inside "0.75" and still match "5 PCS" later on the line.
      for (let i = text.indexOf(f); i >= 0; i = text.indexOf(f, i + 1)) {
        if (!numeric) return true;
        const before = text[i - 1] ?? '';
        const after = text.slice(i + f.length, i + f.length + 2);
        if (!/[\d.,]/.test(before) && !/^(\d|[.,]\d)/.test(after)) return true;
      }
      return false;
    });
  });
  const line = (hint && candidates.find((l) => hint.test(l.text))) || candidates[0];
  return line ? { documentId, page: line.page, bbox: line.bbox, rawText: line.text } : undefined;
}

/**
 * findSource for a rule's evidence field. HTS numbers are normalized to digits ("940360") but
 * printed with dots ("9403.60" or "9403.60.1020"), so for those fields the dotted form is tried too.
 */
export function findFieldSource(pdf: PdfText, documentId: string, field: string, value: string): SourceRef | undefined {
  const found = findSource(pdf, documentId, value);
  if (found || !/(^|\.)(htsCode|hsCode)$/.test(field) || !/^\d{6,10}$/.test(value)) return found;
  const dotted = value.replace(/^(\d{4})(\d{2})(\d*)$/, (_, a, b, rest) => `${a}.${b}${rest ? `.${rest}` : ''}`);
  return findSource(pdf, documentId, dotted);
}
