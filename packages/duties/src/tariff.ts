import type { Destination } from '@doccheck/schemas';
import { parseRate, parseSpecialColumn, programCode, type Rate } from './rates';
import type { CaTariffTable, DutyTables, UsHtsTable } from './tables';

/**
 * A tariff line that carries rates: an HTSUS 8-digit subheading or a Customs Tariff 8-digit tariff
 * item, with its 10-digit statistical / classification number when it is known.
 */
export interface TariffLine {
  destination: Destination;
  /** The line the rates are printed on: "8482.10.50", "6109.10.00". */
  code: string;
  /** 10 digits when known (given on the invoice, or the only statistical line under the code). */
  classification?: string;
  /** Description with its parents: "Ball or roller bearings › Ball bearings › Other". */
  description: string;
  /** Units of quantity for the statistical line(s): "No.", "kg" (US) or "NMB", "KGM" (CA). */
  units: string[];
  /** US: "general", "column2" and each special program code ("S", "CO", "KR"). CA: each tariff treatment ("MFN", "UST", "CPTPT"). */
  rates: Record<string, Rate>;
  footnotes?: string;
}

export type TariffMatch =
  /** The invoice gives the full rate line (8 digits or more). */
  | 'exact'
  /** The invoice gives fewer digits, and only one rate line sits under them. */
  | 'single'
  /** Several rate lines under the given digits with different rates: the estimate uses the highest. */
  | 'several'
  | 'none';

export interface TariffLookup {
  match: TariffMatch;
  input: string;
  line?: TariffLine;
  candidates: TariffLine[];
}

export const hsDigits = (code: string): string => code.replace(/\D/g, '');

/** "848210" → "8482.10", "8482105004" → "8482.10.50.04". */
export function formatTariff(digits: string): string {
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean);
  return parts.join('.');
}

interface Indexed {
  /** Rate-bearing lines by digits. */
  rated: Map<string, TariffLine>;
  /** Digits of rated lines, sorted, for prefix search. */
  ratedKeys: string[];
  /** 10-digit statistical lines by digits → [description, units]. */
  stats: Map<string, { description: string; units: string[] }>;
}

const indexes = new WeakMap<object, Indexed>();

function indexUs(table: UsHtsTable): Indexed {
  const cached = indexes.get(table);
  if (cached) return cached;
  const rated = new Map<string, TariffLine>();
  const stats = new Map<string, { description: string; units: string[] }>();
  // Description path by indent: a row's parents are the last rows with a smaller indent.
  const path: string[] = [];
  let current: TariffLine | undefined;
  for (const [code, indent, description, units, general, special, column2, footnotes] of table.rows) {
    path.length = indent;
    path[indent] = description.replace(/:$/, '');
    if (!code) continue;
    const digits = hsDigits(code);
    const full = path.filter(Boolean).join(' › ');
    if (general) {
      const rates: Record<string, Rate> = { general: parseRate(general) };
      if (column2) rates.column2 = parseRate(column2);
      for (const s of parseSpecialColumn(special)) for (const p of s.programs) rates[programCode(p)] = s.rate;
      current = { destination: 'US', code, description: full, units: units ? units.split(',') : [], rates, ...(footnotes ? { footnotes } : {}) };
      rated.set(digits, current);
      if (digits.length === 10) current.classification = code;
    } else if (digits.length === 10) {
      stats.set(digits, { description: full, units: units ? units.split(',') : [] });
      if (current && digits.startsWith(hsDigits(current.code)) && current.units.length === 0) current.units = units ? units.split(',') : [];
    }
  }
  const out = { rated, ratedKeys: [...rated.keys()].sort(), stats };
  indexes.set(table, out);
  return out;
}

function indexCa(table: CaTariffTable): Indexed {
  const cached = indexes.get(table);
  if (cached) return cached;
  const rated = new Map<string, TariffLine>();
  const stats = new Map<string, { description: string; units: string[] }>();
  // Parents by code: "6109.10.00" → "6109.10" → "6109". Group rows ("6109.10.00.1") name a level too.
  const names = new Map<string, string>();
  for (const [code, description] of table.rows) names.set(code, description.replace(/:$/, ''));
  const pathOf = (code: string): string => {
    const parts: string[] = [];
    const segs = code.split('.');
    for (let i = 1; i <= segs.length; i++) {
      const prefix = segs.slice(0, i).join('.');
      const n = names.get(prefix);
      if (n) parts.push(n);
      // A group row such as "1509.20.00.1" sits between the item and its classification numbers.
      if (i === 3 && segs[3]?.length === 2) {
        const group = names.get(`${prefix}.${segs[3][0]}`);
        if (group) parts.push(group);
      }
    }
    return [...new Set(parts)].join(' › ');
  };
  for (const [code, , uom, , rates] of table.rows) {
    const digits = hsDigits(code);
    if (digits.length === 8 && Object.keys(rates).length > 0) {
      const parsed: Record<string, Rate> = {};
      for (const [t, text] of Object.entries(rates)) parsed[t] = parseRate(text);
      rated.set(digits, { destination: 'CA', code, description: pathOf(code), units: uom ? [uom] : [], rates: parsed });
    } else if (digits.length === 10) {
      stats.set(digits, { description: pathOf(code), units: uom ? [uom] : [] });
      const parent = rated.get(digits.slice(0, 8));
      if (parent && parent.units.length === 0 && uom) parent.units = [uom];
    }
  }
  const out = { rated, ratedKeys: [...rated.keys()].sort(), stats };
  indexes.set(table, out);
  return out;
}

function statChildren(idx: Indexed, digits: string): string[] {
  return [...idx.stats.keys()].filter((k) => k.startsWith(digits));
}

/** Fills in the 10-digit number when the input gives it or the line has only one. */
function withClassification(idx: Indexed, line: TariffLine, inputDigits: string): TariffLine {
  if (line.classification) return line;
  const lineDigits = hsDigits(line.code);
  if (inputDigits.length === 10 && idx.stats.has(inputDigits)) {
    const s = idx.stats.get(inputDigits)!;
    return { ...line, classification: formatTariff(inputDigits), description: s.description, units: s.units.length ? s.units : line.units };
  }
  const children = statChildren(idx, lineDigits);
  if (children.length === 1) {
    const s = idx.stats.get(children[0])!;
    return { ...line, classification: formatTariff(children[0]), units: s.units.length ? s.units : line.units };
  }
  return line;
}

/**
 * Finds the rate line for an HS code as printed on the invoice. 8 digits or more give the line
 * (`exact`); 6 digits give every line under the subheading: one (`single`), or several with
 * different rates (`several`, the caller decides which one to apply and says so).
 */
export function lookupTariff(tables: DutyTables, destination: Destination, hsCode: string): TariffLookup {
  const idx = destination === 'US' ? indexUs(tables.usHts) : indexCa(tables.caTariff);
  const digits = hsDigits(hsCode);
  const none: TariffLookup = { match: 'none', input: hsCode, candidates: [] };
  if (digits.length < 4) return none;

  if (digits.length >= 8) {
    // The longest rate line that is a prefix of the input (a 10-digit US line can carry its own rate).
    for (const len of [10, 8]) {
      const line = idx.rated.get(digits.slice(0, len));
      if (line && digits.length >= len) return { match: 'exact', input: hsCode, line: withClassification(idx, line, digits), candidates: [line] };
    }
  }
  const candidates = idx.ratedKeys.filter((k) => k.startsWith(digits.slice(0, Math.min(digits.length, 8)))).map((k) => withClassification(idx, idx.rated.get(k)!, digits));
  if (candidates.length === 0) return none;
  if (candidates.length === 1) return { match: 'single', input: hsCode, line: candidates[0], candidates };
  const same = candidates.every((c) => sameRates(c, candidates[0]));
  if (!same) return { match: 'several', input: hsCode, candidates };
  // Same rates on every line under the input: the rate is known, the line is not; name it by the digits all of them share.
  const common = candidates.map((c) => hsDigits(c.code)).reduce((a, b) => {
    let n = 0;
    while (n < a.length && a[n] === b[n]) n++;
    return a.slice(0, n);
  });
  const code = formatTariff(common.length % 2 ? common.slice(0, -1) : common);
  return { match: 'single', input: hsCode, line: { ...candidates[0], code, classification: undefined, description: candidates[0].description.split(' › ').slice(0, -1).join(' › ') || candidates[0].description }, candidates };
}

function sameRates(a: TariffLine, b: TariffLine): boolean {
  const keys = new Set([...Object.keys(a.rates), ...Object.keys(b.rates)]);
  return [...keys].every((k) => a.rates[k]?.text === b.rates[k]?.text);
}
