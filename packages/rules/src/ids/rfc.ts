/**
 * Mexican RFC (Registro Federal de Contribuyentes): 3 letters for a company (persona moral) or 4 for a
 * person (persona física), the date of incorporation or birth as YYMMDD, and a 3-character homoclave
 * whose last character is a check digit (modulo 11 over SAT's character table).
 */
const RFC = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{2})([A\d])$/;

/** SAT's value table for the check digit: 0-9, A-N, &, O-Z, space, Ñ. */
const TABLE = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

/** Generic RFCs SAT publishes for the general public and for foreign residents; their check digit is not computed. */
export const GENERIC_RFCS = ['XAXX010101000', 'XEXX010101000'];

/** Strips the spaces and hyphens printed inside an RFC ("GODE-561231-GR8"). */
export const compactRfc = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');

/** Check digit of the first 11 (company) or 12 (person) characters. */
export function rfcCheckDigit(first: string): string {
  const padded = first.length === 11 ? ` ${first}` : first;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = TABLE.indexOf(padded[i]);
    if (v < 0) throw new Error(`Character "${padded[i]}" is not allowed in an RFC`);
    sum += v * (13 - i);
  }
  const r = sum % 11;
  if (r === 0) return '0';
  return 11 - r === 10 ? 'A' : String(11 - r);
}

export type RfcProblem = 'format' | 'date' | 'check_digit';

/** null when the RFC is valid; otherwise what is wrong with it. */
export function rfcProblem(raw: string): RfcProblem | null {
  const rfc = compactRfc(raw);
  if (GENERIC_RFCS.includes(rfc)) return null;
  const m = rfc.match(RFC);
  if (!m) return 'format';
  const [, , yy, mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  // The century is not encoded; 2000 is a leap year, so 29 February is accepted for every "00".
  const days = new Date(Date.UTC(2000 + Number(yy), month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days) return 'date';
  return rfcCheckDigit(rfc.slice(0, -1)) === rfc.slice(-1) ? null : 'check_digit';
}

export const isValidRfc = (raw: string) => rfcProblem(raw) === null;
