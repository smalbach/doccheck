import { fieldPointer, type SourceRef } from '@doccheck/schemas';
import type { ExtractableType } from './extract';
import type { PdfText, TextLine } from './pdf-text';
import { findSource } from './provenance';

/**
 * How sure the extraction is of each value, so a person checks the doubtful ones first (the review
 * queue). No model is asked: the confidence comes from signals the pipeline already has.
 *
 * - not-printed: the value the model copied ("as printed") is not on any line of the PDF text.
 * - ocr: the value sits on a page read with OCR; the engine's mean confidence caps it.
 * - normalizer: the normalizer could not read what the model copied (the value was dropped).
 * - passes-disagree: a second extraction pass, when one ran, read something else.
 * - low-logprob: the model's own token probabilities for the value, when the provider returns them
 *   for every token (Ollama 0.35 with a JSON schema returns only the first one, so it rarely applies).
 *
 * A field's confidence is the lowest of its signals, from 0 to 1 in hundredths.
 */
export type ConfidenceReason = 'not-printed' | 'ocr' | 'normalizer' | 'passes-disagree' | 'low-logprob';

export interface FieldConfidence {
  /** JSON pointer into the normalized document ("/lines/0/quantity/value"), the one corrections use. */
  path: string;
  /** The value in the normalized document; null when the normalizer dropped it. */
  value: string | number | null;
  /** What the model copied from the document, if anything. */
  printed: string | null;
  confidence: number;
  reasons: ConfidenceReason[];
  /** Where the value is printed, for the highlight in the review screen. */
  source?: SourceRef;
}

/** Below this a field goes to the review queue (REVIEW_THRESHOLD overrides it). */
export const DEFAULT_REVIEW_THRESHOLD = 0.85;

/** Confidence of a value the PDF text does not print. */
const NOT_PRINTED = 0.5;
/** Confidence of a value the normalizer could not read. */
const UNREADABLE = 0.3;
/** Confidence of a value two passes read differently. */
const DISAGREE = 0.4;

/**
 * The fields worth a person's check, as [normalized path, raw path] (raw-schemas.ts). [*] runs over
 * the items; the raw item at the same index is the one the normalized item came from. Other document
 * types are scored only on the values their normalizer could not read.
 */
export const REVIEW_FIELDS: Partial<Record<ExtractableType, [string, string][]>> = {
  COMMERCIAL_INVOICE: [
    ['invoiceNumber', 'invoiceNumber'], ['invoiceDate', 'invoiceDate'], ['poNumber', 'poNumber'], ['shipmentDate', 'shipmentDate'],
    ['seller.name', 'seller.name'], ['buyer.name', 'buyer.name'], ['consignee.name', 'consignee.name'], ['portOfEntry.name', 'portOfEntry.name'],
    ['currency', 'currency'], ['incoterm.code', 'incotermCode'], ['packageCount', 'totalPackages'],
    ['grossWeight.kg', 'grossWeight.value'], ['netWeight.kg', 'netWeight.value'],
    ['invoiceTotal.amount', 'invoiceTotal'],
    ['lines[*].description', 'lines[*].description'], ['lines[*].quantity.value', 'lines[*].quantity'],
    ['lines[*].unitPrice.amount', 'lines[*].unitPrice'], ['lines[*].lineTotal.amount', 'lines[*].lineTotal'],
    ['lines[*].countryOfOrigin', 'lines[*].countryOfOrigin'], ['lines[*].hsCode', 'lines[*].hsCode'],
  ],
  PACKING_LIST: [
    ['packingListNumber', 'packingListNumber'], ['invoiceRef', 'invoiceRef'], ['seller.name', 'seller.name'], ['consignee.name', 'consignee.name'],
    ['totals.packageCount', 'totalPackages'], ['totals.netWeight.kg', 'totalNetWeight.value'], ['totals.grossWeight.kg', 'totalGrossWeight.value'],
    ['packages[*].count', 'packages[*].count'], ['packages[*].netWeight.kg', 'packages[*].netWeight.value'], ['packages[*].grossWeight.kg', 'packages[*].grossWeight.value'],
  ],
  BILL_OF_LADING: [
    ['blNumber', 'blNumber'], ['bookingNumber', 'bookingNumber'], ['carrier.scac', 'scac'],
    ['shipper.name', 'shipper.name'], ['consignee.name', 'consignee.name'], ['notifyParty.name', 'notifyParty.name'],
    ['vessel', 'vessel'], ['voyage', 'voyage'], ['portOfLoading.name', 'portOfLoading.name'], ['portOfDischarge.name', 'portOfDischarge.name'],
    ['totalPackages', 'totalPackages'], ['totalGrossWeight.kg', 'totalGrossWeight.value'], ['shippedOnBoardDate', 'shippedOnBoardDate'],
    ['containers[*].number', 'containers[*].number'], ['containers[*].seal', 'containers[*].seal'], ['containers[*].packages', 'containers[*].packages'],
    ['containers[*].grossWeight.kg', 'containers[*].grossWeight.value'],
  ],
  ISF: [
    ['importerOfRecordNumber', 'importerOfRecordNumber'], ['consigneeNumber', 'consigneeNumber'],
    ['seller.name', 'seller.name'], ['buyer.name', 'buyer.name'], ['manufacturer.name', 'manufacturer.name'],
    ['shipToParty.name', 'shipToParty.name'], ['consolidator.name', 'consolidator.name'],
    ['countryOfOrigin', 'countryOfOrigin'], ['htsCode', 'htsCode'],
  ],
};

/** The value at a dotted path with numeric indexes ("lines[2].quantity.value"). */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Each [*] of `pattern` replaced by the indexes of the arrays found in `obj` ("lines[*].x" -> "lines[0].x", "lines[1].x"…). */
export function expandPattern(obj: unknown, pattern: string): string[] {
  const star = pattern.indexOf('[*]');
  if (star < 0) return [pattern];
  const list = getPath(obj, pattern.slice(0, star));
  if (!Array.isArray(list)) return [];
  return list.flatMap((_, i) => expandPattern(obj, `${pattern.slice(0, star)}[${i}]${pattern.slice(star + 3)}`));
}

const round = (x: number) => Math.round(x * 100) / 100;

const asText = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null);

/**
 * Where a printed value appears. Long text may wrap onto a second line in its cell, so a value of
 * more than four words is also found by its first words.
 */
function locate(pdf: PdfText, documentId: string, printed: string): SourceRef | undefined {
  const found = findSource(pdf, documentId, printed);
  if (found) return found;
  const words = printed.split(/\s+/);
  return words.length > 4 ? findSource(pdf, documentId, words.slice(0, 3).join(' ')) : undefined;
}

/**
 * OCR confidence (0-1) of the words a printed value is read from, on the line that prints it; the
 * lowest word of the line when the value cannot be placed on it. Undefined without word scores.
 */
export function ocrWordConfidence(line: TextLine | undefined, printed: string): number | undefined {
  if (!line?.ocr?.length) return undefined;
  const at = line.text.toUpperCase().indexOf(printed.toUpperCase());
  const words = at < 0 ? line.ocr : line.ocr.filter(([s, e]) => e > at && s < at + printed.length);
  const scores = (words.length ? words : line.ocr).map(([, , c]) => c);
  return Math.min(...scores) / 100;
}

export interface ConfidenceInput {
  type: ExtractableType;
  documentId: string;
  /** The model's answer (values as printed). */
  raw: unknown;
  /** The normalized document (or what could be normalized). */
  data: unknown;
  pdf: PdfText;
  /** The extraction's issues ("field: could not normalize …"). */
  issues: string[];
  /** Lowest token log-probability per raw dotted path, when the provider gave them. */
  logprobs?: Record<string, number>;
  /** A second pass's answer, to compare with `raw`. */
  secondRaw?: unknown;
}

/** One entry per reviewable field that has a value, plus one per value the normalizer dropped. */
export function fieldConfidence(input: ConfidenceInput): FieldConfidence[] {
  const { type, documentId, raw, data, pdf } = input;
  const ocrPages = new Set(pdf.ocrPages ?? []);
  const ocrCap = pdf.ocrConfidence !== undefined ? pdf.ocrConfidence / 100 : 0.7;
  const out: FieldConfidence[] = [];
  const seen = new Set<string>();

  for (const [pattern, rawPattern] of REVIEW_FIELDS[type] ?? []) {
    for (const field of expandPattern(data, pattern)) {
      const value = getPath(data, field);
      if (value === null || value === undefined || typeof value === 'object') continue;
      // The raw path with the same indexes, in order.
      const indexes = [...field.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
      let i = 0;
      const rawField = rawPattern.replace(/\[\*\]/g, () => `[${indexes[i++]}]`);
      const printed = asText(getPath(raw, rawField));
      const reasons: ConfidenceReason[] = [];
      let confidence = 1;
      const lower = (to: number, reason: ConfidenceReason) => {
        if (to < confidence) confidence = to;
        if (to < 1 && !reasons.includes(reason)) reasons.push(reason);
      };
      const source = printed ? locate(pdf, documentId, printed) : undefined;
      if (printed && !source) lower(NOT_PRINTED, 'not-printed');
      if (source && ocrPages.has(source.page)) {
        // The words' own scores when the engine gave them, else the page's mean confidence.
        const line = pdf.lines.find((l) => l.page === source.page && l.text === source.rawText);
        lower(ocrWordConfidence(line, printed!) ?? ocrCap, 'ocr');
      }
      if (!source && ocrPages.size > 0) lower(ocrCap, 'ocr');
      const lp = input.logprobs?.[rawField];
      if (lp !== undefined) lower(Math.exp(lp), 'low-logprob');
      if (input.secondRaw !== undefined && asText(getPath(input.secondRaw, rawField)) !== printed) lower(DISAGREE, 'passes-disagree');
      const path = fieldPointer(field);
      seen.add(path);
      out.push({ path, value: value as string | number, printed, confidence: round(confidence), reasons, ...(source ? { source } : {}) });
    }
  }

  // "grossWeight: could not normalize "1.2O0 KG"": the value is gone from the document, check it by hand.
  for (const issue of input.issues) {
    const m = issue.match(/^([A-Za-z]\w*(?:\[\d+\])?(?:\.[A-Za-z]\w*(?:\[\d+\])?)*): (?:could not normalize (".*")|"(.*)" does not look like)/);
    if (!m) continue;
    const path = fieldPointer(m[1]!);
    if (seen.has(path)) continue;
    seen.add(path);
    let printed: string | null = null;
    try {
      printed = m[2] ? asText(JSON.parse(m[2])) : (m[3] ?? null);
    } catch {
      printed = null;
    }
    const source = printed ? locate(pdf, documentId, printed) : undefined;
    out.push({ path, value: null, printed, confidence: UNREADABLE, reasons: ['normalizer'], ...(source ? { source } : {}) });
  }
  return out;
}

/** The fields under the threshold, least sure first. */
export function lowConfidence(fields: FieldConfidence[], threshold = DEFAULT_REVIEW_THRESHOLD): FieldConfidence[] {
  return fields.filter((f) => f.confidence < threshold).sort((a, b) => a.confidence - b.confidence);
}

/**
 * Character spans of the leaf values in a JSON text, keyed by dotted path ("lines[0].quantity"):
 * for a string, the characters between its quotes. Used to map token log-probabilities to fields.
 */
export function jsonLeafSpans(text: string): Map<string, [number, number]> {
  const spans = new Map<string, [number, number]>();
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const str = (): [number, number] => {
    const start = ++i;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    return [start, i++];
  };
  const value = (path: string): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      while (i < text.length && text[i] !== '}') {
        ws();
        const [ks, ke] = str();
        const key = text.slice(ks, ke);
        ws();
        i++; // :
        value(path ? `${path}.${key}` : key);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '[') {
      i++;
      let n = 0;
      ws();
      while (i < text.length && text[i] !== ']') {
        value(`${path}[${n++}]`);
        ws();
        if (text[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '"') {
      spans.set(path, str());
    } else {
      const start = i;
      while (i < text.length && !/[,}\]\s]/.test(text[i]!)) i++;
      if (text.slice(start, i) !== 'null') spans.set(path, [start, i]);
    }
  };
  try {
    value('');
  } catch {
    // A malformed text keeps the spans found so far.
  }
  return spans;
}

export interface TokenLogprob {
  token: string;
  logprob: number;
}

/**
 * Lowest token log-probability per leaf value of the answer. Only when the tokens spell out the whole
 * answer (some providers return fewer); otherwise undefined.
 */
export function leafLogprobs(content: string, tokens: TokenLogprob[] | undefined): Record<string, number> | undefined {
  if (!tokens?.length || tokens.map((t) => t.token).join('') !== content) return undefined;
  const starts: number[] = [];
  let at = 0;
  for (const t of tokens) {
    starts.push(at);
    at += t.token.length;
  }
  const out: Record<string, number> = {};
  for (const [path, [from, to]] of jsonLeafSpans(content)) {
    if (to <= from) continue;
    let min = 0;
    tokens.forEach((t, k) => {
      const s = starts[k]!;
      const e = s + t.token.length;
      if (e > from && s < to && t.logprob < min) min = t.logprob;
    });
    out[path] = min;
  }
  return out;
}
