import type { Destination } from '@doccheck/schemas';

/** Digits of an HS or tariff code as printed: "9503.00.00.90" -> "9503000090". */
export const hsDigits = (raw: string) => raw.replace(/\D/g, '');

/** Digits in the usual dotted form, 4.2.2.2: "9503000090" -> "9503.00.00.90". */
export function formatHs(digits: string): string {
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  return parts.join('.');
}

/** HS heading in the dotted form both schedules print in their notes: "9503" -> "95.03". */
export const headingRef = (d4: string) => `${d4.slice(0, 2)}.${d4.slice(2, 4)}`;

/**
 * Chapters 98 and 99 are national provisions (special classification, temporary duties), not part
 * of the international HS: their codes are checked against the destination schedule only.
 */
export const isNationalChapter = (digits: string) => /^9[89]/.test(digits);

export type HsFormat =
  /** 6 (HS subheading), 8 (tariff item) or 10 digits (with the statistical suffix). */
  | 'ok'
  /** 4 digits: the heading only. */
  | 'heading-only'
  /** Any other length, or not a number. */
  | 'malformed';

export function hsFormat(raw: string): HsFormat {
  const digits = hsDigits(raw);
  if (!/^[\d.\s-]+$/.test(raw.trim()) || digits.length === 0) return 'malformed';
  if (digits.length === 4) return 'heading-only';
  return [6, 8, 10].includes(digits.length) ? 'ok' : 'malformed';
}

/** What each destination declares at entry, for messages. */
export const ENTRY_CODE: Record<Destination, string> = {
  US: 'the 10-digit HTSUS statistical reporting number',
  CA: 'the 10-digit classification number (8-digit tariff item and 2-digit statistical suffix)',
  MX: 'the 8-digit TIGIE tariff fraction and its 2-digit NICO',
  EU: 'the 8-digit Combined Nomenclature code (10-digit TARIC code at import)',
  GB: 'the 10-digit UK commodity code',
};
