import { parsePointer } from '@doccheck/schemas';
import { getPath, REVIEW_FIELDS } from './confidence';
import type { ExtractableType } from './extract';
import type { PdfText } from './pdf-text';
import { findSource } from './provenance';

/**
 * A value a person corrected on an earlier document from the same supplier, given to the model as an
 * example on the next ones (few-shot). Suppliers keep their layouts: one that prints the net and gross
 * labels the wrong way round does it on every invoice, and the model repeats the misreading until it
 * is shown the correction.
 */
export interface SupplierExample {
  documentType: ExtractableType;
  /**
   * The answer field the model fills ("netWeight.value"); an item field is kept for every item
   * ("packages[*].netWeight.value"): a layout that misleads on one row misleads on all of them.
   */
  field: string;
  /** What the model had copied; null when it left the field empty. */
  modelValue: string | null;
  /** The corrected value, normalized ("1250.000" kg, "2026-03-14"); null when the value was removed. */
  correctValue: string | null;
  /** The document line where the corrected value is printed, if it is found. */
  line?: string;
}

/** At most this many examples go into one prompt (SUPPLIER_EXAMPLES, set from admin, overrides it). */
export const DEFAULT_SUPPLIER_EXAMPLES = 5;

/** "/lines/0/quantity/value" -> "lines[0].quantity.value" */
export function pointerToField(pointer: string): string | undefined {
  const segments = parsePointer(pointer);
  if (!segments?.length) return undefined;
  return segments.map((s, i) => (/^\d+$/.test(s) ? `[${s}]` : i === 0 ? s : `.${s}`)).join('');
}

/** The answer field a normalized field comes from, by REVIEW_FIELDS ("netWeight.kg" -> "netWeight.value"). */
export function rawFieldOf(type: ExtractableType, field: string): string | undefined {
  const pattern = field.replace(/\[\d+\]/g, '[*]');
  const entry = REVIEW_FIELDS[type]?.find(([normalized]) => normalized === pattern);
  if (!entry) return undefined;
  const indexes = [...field.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
  let i = 0;
  return entry[1].replace(/\[\*\]/g, () => `[${indexes[i++]}]`);
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

/**
 * The example a correction makes, or undefined when the field is not one the model fills directly
 * (only REVIEW_FIELDS are learned).
 */
export function exampleFromCorrection(input: {
  documentType: ExtractableType;
  path: string;
  newValue: unknown;
  /** The model's answer for that document. */
  raw: unknown;
  pdf?: Pick<PdfText, 'lines'>;
}): SupplierExample | undefined {
  const field = pointerToField(input.path);
  if (!field) return undefined;
  const rawField = rawFieldOf(input.documentType, field);
  if (!rawField) return undefined;
  const correctValue = text(input.newValue);
  const modelValue = text(getPath(input.raw, rawField));
  if (correctValue === modelValue) return undefined;
  const found = correctValue && input.pdf ? findSource({ pageCount: 0, text: '', lines: input.pdf.lines }, '', correctValue) : undefined;
  return { documentType: input.documentType, field: rawField.replace(/\[\d+\]/g, '[*]'), modelValue, correctValue, ...(found ? { line: found.rawText.replace(/\s+/g, ' ').trim() } : {}) };
}

/** The prompt section with the supplier's corrected examples (empty without examples). */
export function examplesPrompt(supplier: string, examples: SupplierExample[]): string {
  if (examples.length === 0) return '';
  const items = examples.map((e) => {
    // Corrected weights are in kilograms (the normalized unit), whatever unit the document prints.
    const unit = /Weight\.value$/.test(e.field) ? ' kg' : '';
    const model = e.modelValue === null ? 'left it empty' : `copied ${JSON.stringify(e.modelValue)}`;
    const right = e.correctValue === null ? 'the field should be empty' : `the right value is ${JSON.stringify(e.correctValue)}${unit}`;
    const where = e.field.includes('[*]') ? ' (on one of the items; read every item the same way)' : '';
    return `- "${e.field}"${where}: you ${model}, but ${right}.${e.line ? ` It is printed on the line: ${JSON.stringify(e.line)}` : ''}`;
  });
  return `Earlier documents from ${supplier} use the same layout. A reviewer corrected these values on them:
${items.join('\n')}
Where this document shows the same layout, read those fields the way the reviewer did. Never copy the example values themselves: read this document's own values.`;
}

/** Names normalized for matching: upper case, letters and digits only. */
export const supplierKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(CO|CORP|CORPORATION|INC|LTD|LIMITED|LLC|GMBH|SA|SAS|SRL|SPA|BV|AG|PLC|COMPANY)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * The known supplier whose name the document prints, before any model call (the examples must go
 * into the first prompt). The longest matching name wins, so "ACME Toys Shenzhen" beats "ACME".
 */
export function detectSupplier<T extends { key: string }>(pdf: Pick<PdfText, 'lines'>, suppliers: T[]): T | undefined {
  const page = ` ${pdf.lines.map((l) => supplierKey(l.text)).join(' ')} `;
  return suppliers.filter((s) => s.key.length >= 3 && page.includes(` ${s.key} `)).sort((a, b) => b.key.length - a.key.length)[0];
}
