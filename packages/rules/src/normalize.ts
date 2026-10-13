/**
 * Text normalization for comparing names and addresses printed by different people on different
 * documents. Deliberately conservative: it only removes differences that never change meaning
 * (case, punctuation, spacing, common abbreviations). Anything fuzzier is the agent's job (phase 4).
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bSTREET\b/g, 'ST'], [/\bAVENUE\b/g, 'AVE'], [/\bBOULEVARD\b|\bBOUL\b/g, 'BLVD'], [/\bROAD\b/g, 'RD'],
  [/\bDRIVE\b/g, 'DR'], [/\bSUITE\b/g, 'STE'], [/\bPARKWAY\b/g, 'PKWY'], [/\bHIGHWAY\b/g, 'HWY'],
  [/\bNORTH\b/g, 'N'], [/\bSOUTH\b/g, 'S'], [/\bEAST\b/g, 'E'], [/\bWEST\b/g, 'W'],
];

const LEGAL_SUFFIXES = /\b(INC|INCORPORATED|LTD|LIMITED|LTEE|LLC|CORP|CORPORATION|CO|COMPANY|GMBH|SPA|SAS|SA|PVT|JSC|PLC)\b/g;

const base = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export function normalizeAddress(s: string): string {
  let t = base(s);
  for (const [re, short] of ABBREVIATIONS) t = t.replace(re, short);
  return t.replace(/\s+/g, ' ').trim();
}

/** Company name without legal form: "Maple Retail Inc." and "MAPLE RETAIL INC" compare equal. */
export function normalizeName(s: string): string {
  return base(s).replace(LEGAL_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}

/** "M5V 3G5" == "m5v3g5"; "90058-1234" keeps the 5-digit ZIP. */
export function normalizePostalCode(s: string): string {
  const t = base(s).replace(/\s+/g, '');
  return /^\d{9}$/.test(t) ? t.slice(0, 5) : t;
}

/**
 * Street lines only. Drops lines that just repeat the locality ("Laval, QC, H7S 1P6", "CA"), which
 * extraction sometimes copies into the street lines although city, region and postal code have fields.
 */
export function streetLines(a: { lines: string[]; city?: string; region?: string; postalCode?: string; country?: string }): string[] {
  const locality = new Set(base([a.city, a.region, a.postalCode, a.country].filter(Boolean).join(' ')).split(' ').filter(Boolean));
  return a.lines.filter((line) => {
    const tokens = base(line).split(' ').filter(Boolean);
    return tokens.length > 0 && !tokens.every((t) => locality.has(t));
  });
}
