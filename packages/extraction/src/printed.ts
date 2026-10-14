import type { CommercialInvoice } from '@doccheck/schemas';
import type { PdfText, TextLine } from './pdf-text';

/**
 * The model sometimes fills in a required field the document leaves blank: a removed consignee
 * becomes the buyer printed next to it, a removed country of origin becomes the seller's country,
 * a port of entry the invoice never prints comes from the terms of sale ("CIF Halifax"). The prompt
 * forbids it and the model does it anyway, and then the required-field rules (C1, U1) pass on a
 * document customs would reject.
 *
 * This check keeps such a value only if the PDF prints it under its own label: on the label's line
 * to its right, or on one of the next lines in the label's column. Positions come from the layout
 * text, where each cell is padded to its page column (pdf-text.ts), so a character index stands for
 * a horizontal position. A value that fails is dropped with an issue, so the rule sees it missing.
 *
 * It is a heuristic: a short code ("CN") printed further down in the label's column by something
 * else would count as printed. On the 260 text-layer invoices of sets v1 and v2 it drops no correct
 * value and catches every filled-in consignee, origin and port of entry.
 */

interface Field {
  /** Label as printed, in any of the templates and languages seen so far. */
  label: RegExp;
  /** How many lines below the label the value may sit (a table column runs further). */
  below: number;
}

const CONSIGNEE: Field = { label: /\b(consignee|ship to|deliver(y address)? to|delivery address|destinataire)\b/i, below: 6 };
const ORIGIN: Field = { label: /\b(country of origin|origin|pays d'origine)\b/i, below: 60 };
const PORT_OF_ENTRY: Field = { label: /\bport of entry\b/i, below: 3 };

/** Characters of horizontal slack between a label and its value (one character is ~4 points). */
const COLUMN_SLACK = 14;
/** On the label's own line, the value must start within this many characters after the label. */
const SAME_LINE_REACH = 40;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Character positions where `value` occurs in the line: whole token for short codes, a prefix for
 * long names. The line keeps its padding (positions are columns); spaces inside the value match any run.
 */
function positions(line: string, value: string): number[] {
  const words = value.toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  // Long names may wrap or be cut: the first words, about 20 characters, are enough to tell parties apart.
  const kept: string[] = [];
  for (const w of words) {
    kept.push(escape(w));
    if (kept.join(' ').length >= 20) break;
  }
  const pattern = kept.join('\\s+');
  const short = value.trim().length <= 3;
  const re = new RegExp(`(?<![A-Z0-9])${pattern}${short ? '(?![A-Z0-9])' : ''}`, 'g');
  return [...line.toUpperCase().matchAll(re)].map((m) => m.index!);
}

/** Whether `value` is printed under a label matching `field` (same page). */
export function printedUnderLabel(pdf: PdfText, value: string, field: Field): boolean {
  const lines = pdf.lines;
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].text.matchAll(new RegExp(field.label.source, 'gi'))) {
      const col = m.index!;
      const end = col + m[0].length;
      // Same line, to the right of the label: "ORIGIN: VN", "Port of entry Miami".
      if (positions(lines[i].text, value).some((p) => p >= end && p - end <= SAME_LINE_REACH)) return true;
      // Below, in the label's column.
      for (let j = i + 1; j <= Math.min(lines.length - 1, i + field.below); j++) {
        if (lines[j].page !== lines[i].page) break;
        if (positions(lines[j].text, value).some((p) => Math.abs(p - col) <= COLUMN_SLACK)) return true;
      }
    }
  }
  return false;
}

/** Does the PDF show any label for this field at all? */
const hasLabel = (pdf: PdfText, field: Field) => pdf.lines.some((l: TextLine) => field.label.test(l.text));

/**
 * Drops the invoice values that are not printed under their label, and says why; returns the issues
 * it added. Text-layer documents only.
 */
export function dropUnprintedInvoiceValues(inv: CommercialInvoice, pdf: PdfText): string[] {
  // OCR text is not reliable enough for this: on the 40 synthetic scans read with tesseract, labels and
  // columns come out shifted or misread and 31 correct values would be dropped (none on the 260
  // text-layer invoices of v1 and v2). Scanned documents already carry a "check against the scan" issue.
  if (pdf.ocrPages?.length) return [];
  const issues: string[] = [];
  if (inv.consignee && hasLabel(pdf, CONSIGNEE) && !printedUnderLabel(pdf, inv.consignee.name, CONSIGNEE)) {
    issues.push(`consignee: "${inv.consignee.name}" is not printed under a consignee label; dropped`);
    delete inv.consignee;
  }
  if (inv.portOfEntry && !printedUnderLabel(pdf, inv.portOfEntry.name, PORT_OF_ENTRY)) {
    issues.push(`portOfEntry: "${inv.portOfEntry.name}" is not printed under a port of entry label; dropped`);
    delete inv.portOfEntry;
  }
  const origins = new Set(inv.lines.map((l) => l.countryOfOrigin).filter((c): c is string => !!c));
  for (const country of origins) {
    if (printedUnderLabel(pdf, country, ORIGIN)) continue;
    issues.push(`lines[*].countryOfOrigin: "${country}" is not printed under an origin label; dropped`);
    for (const l of inv.lines) if (l.countryOfOrigin === country) delete l.countryOfOrigin;
  }
  return issues;
}
