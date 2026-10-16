import { toFixed } from './decimal';
import unlocode from './data/unlocode.json';

/**
 * Reference data and identifier checks used by rules X13–X24, C3 and U4. All of it is bundled with
 * the package (no lookups at run time), so a rule gives the same answer every time it runs.
 */

// UN/LOCODE --------------------------------------------------------------------------------------

const locodes = new Map<string, Set<string>>();
const portCodes = new Map<string, Set<string>>();
const unpack = (packed: Record<string, string>, cache: Map<string, Set<string>>, country: string) => {
  let set = cache.get(country);
  if (!set) {
    const s = packed[country] ?? '';
    set = new Set(Array.from({ length: s.length / 3 }, (_, i) => s.slice(i * 3, i * 3 + 3)));
    cache.set(country, set);
  }
  return set;
};

/** Release of the bundled list (scripts/fetch-unlocode.mjs). */
export const UNLOCODE_SOURCE: string = `${unlocode.source}, fetched ${unlocode.fetched}`;

/** "CNYTN" or "CN YTN" is in the UNECE code list. */
export function isKnownLocode(code: string): boolean {
  const c = code.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z2-9]{3}$/.test(c) && unpack(unlocode.codes as Record<string, string>, locodes, c.slice(0, 2)).has(c.slice(2));
}

/** The code has the port function ("1") in the UNECE list. */
export function isPortLocode(code: string): boolean {
  const c = code.replace(/\s+/g, '').toUpperCase();
  return unpack(unlocode.ports as Record<string, string>, portCodes, c.slice(0, 2)).has(c.slice(2));
}

// Carriers ---------------------------------------------------------------------------------------

/**
 * SCACs of the main ocean carriers (container lines that issue master BLs to US and Canadian ports).
 * Not exhaustive: NVOCCs and regional lines have their own codes, which an account adds in its
 * rule settings (knownScacs) instead of seeing them flagged.
 */
export const OCEAN_CARRIER_SCACS: Record<string, string> = {
  ACLU: 'Atlantic Container Line',
  ANNU: 'ANL Container Line',
  APLU: 'APL',
  CMDU: 'CMA CGM',
  COSU: 'COSCO Shipping Lines',
  EGLV: 'Evergreen Line',
  HDMU: 'HMM',
  HLCU: 'Hapag-Lloyd',
  MAEU: 'Maersk',
  MATS: 'Matson',
  MSCU: 'MSC Mediterranean Shipping Company',
  ONEY: 'Ocean Network Express',
  OOLU: 'OOCL',
  PABV: 'Pacific International Lines',
  SAFM: 'Safmarine',
  SEAU: 'Sealand',
  SMLM: 'SM Line',
  SUDU: 'Hamburg Süd',
  WHLC: 'Wan Hai Lines',
  YMLU: 'Yang Ming',
  ZIMU: 'ZIM',
};

/** A SCAC is 2 to 4 capital letters (NMFTA). */
export const isScacFormat = (scac: string): boolean => /^[A-Z]{2,4}$/.test(scac);

/**
 * IMO ship identification number: 7 digits; each of the first six times 7, 6, 5, 4, 3, 2, and the
 * last digit of the sum is the seventh. "IMO 9074729" is valid.
 */
export function isValidImo(imo: string): boolean {
  const d = imo.replace(/^IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(d)) return false;
  const sum = [...d.slice(0, 6)].reduce((acc, ch, i) => acc + Number(ch) * (7 - i), 0);
  return sum % 10 === Number(d[6]);
}

// Identifiers ------------------------------------------------------------------------------------

/** Luhn (mod 10), the check digit of a Canadian Business Number's 9 digits. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface BusinessNumber {
  bn9: string;
  program?: string;
  reference?: string;
}

/** "123456782 RM 0001", "123456782RM0001" or "123456782" into its parts; null when it is not a BN at all. */
export function parseBusinessNumber(value: string): BusinessNumber | null {
  const m = value.toUpperCase().replace(/[\s-]+/g, '').match(/^(\d{9})(?:([A-Z]{2})(\d{4}))?$/);
  return m ? { bn9: m[1], ...(m[2] ? { program: m[2], reference: m[3] } : {}) } : null;
}

/**
 * Prefixes the IRS has never assigned to an EIN (the first two digits name the campus that issued it).
 * "07-1234567" cannot be an EIN.
 */
const EIN_UNUSED_PREFIXES = new Set(['00', '07', '08', '09', '17', '18', '19', '28', '29', '49', '69', '70', '78', '79', '89', '96', '97']);

export type ImporterNumberKind = 'EIN' | 'EIN_SUFFIX' | 'CBP' | 'SSN';

/**
 * A US importer of record number as CBP accepts it on entries and the ISF (CBP Form 5106):
 * IRS EIN "NN-NNNNNNN", EIN with a 2-digit suffix "NN-NNNNNNNXX", CBP-assigned "YYDDPP-NNNNN",
 * or a social security number "NNN-NN-NNNN". Null when it is none of them.
 */
export function importerNumberKind(value: string): ImporterNumberKind | null {
  const v = value.trim().toUpperCase();
  if (/^\d{6}-\d{5}$/.test(v)) return 'CBP';
  if (/^\d{3}-\d{2}-\d{4}$/.test(v)) return 'SSN';
  const digits = v.replace(/-/g, '');
  if (!/^[\d-]+$/.test(v)) return null;
  if (/^\d{9}$/.test(digits) && /^\d{2}-?\d{7}$/.test(v)) return 'EIN';
  if (/^\d{11}$/.test(digits) && /^\d{2}-?\d{9}$/.test(v)) return 'EIN_SUFFIX';
  return null;
}

export const einPrefixUnused = (value: string): boolean => EIN_UNUSED_PREFIXES.has(value.replace(/\D/g, '').slice(0, 2));

// Containers -------------------------------------------------------------------------------------

/**
 * Usable inside volume (m3), maximum payload (kg) and typical tare (kg) of common ISO containers.
 * Figures are conservative maxima across the main lines' published specifications: a load above them
 * does not fit, whoever owns the box.
 */
export interface ContainerSpec {
  type: string;
  capacityM3: string;
  maxPayloadKg: string;
  tareKg: string;
}

export const CONTAINER_SPECS: Record<string, ContainerSpec> = {
  '20GP': { type: '20GP', capacityM3: '33.2', maxPayloadKg: '28300', tareKg: '2300' },
  '40GP': { type: '40GP', capacityM3: '67.7', maxPayloadKg: '28800', tareKg: '3750' },
  '40HC': { type: '40HC', capacityM3: '76.4', maxPayloadKg: '28600', tareKg: '3940' },
  '45HC': { type: '45HC', capacityM3: '86.0', maxPayloadKg: '27700', tareKg: '4800' },
  '20RF': { type: '20RF', capacityM3: '28.3', maxPayloadKg: '27400', tareKg: '3080' },
  '40RF': { type: '40RF', capacityM3: '67.5', maxPayloadKg: '29500', tareKg: '4800' },
};

/** "40'HC", "40HQ", "40 HIGH CUBE", ISO 6346 size-type "45G1" → "40HC"; null when unknown. */
export function containerTypeOf(raw: string | undefined): ContainerSpec | null {
  if (!raw) return null;
  const t = raw.toUpperCase().replace(/[\s'’"-]+/g, '').replace(/FT|FOOT|FEET/g, '');
  const iso: Record<string, string> = { '22G1': '20GP', '22G0': '20GP', '42G1': '40GP', '42G0': '40GP', '45G1': '40HC', '45G0': '40HC', L5G1: '45HC', '22R1': '20RF', '45R1': '40RF', '42R1': '40RF' };
  if (iso[t]) return CONTAINER_SPECS[iso[t]];
  const m = t.match(/^(20|40|45)(GP|DV|DC|ST|STD|DRY|HC|HQ|HIGHCUBE|RF|RH|REEFER|RFHC|RQ)?$/);
  if (!m) return null;
  const kind = m[2] ?? 'GP';
  if (m[1] === '45') return CONTAINER_SPECS['45HC'];
  if (/^(RF|RH|REEFER|RFHC|RQ)$/.test(kind)) return CONTAINER_SPECS[`${m[1]}RF`];
  if (/^(HC|HQ|HIGHCUBE)$/.test(kind)) return m[1] === '40' ? CONTAINER_SPECS['40HC'] : null;
  return CONTAINER_SPECS[`${m[1]}GP`];
}

// Units of measure -------------------------------------------------------------------------------

/** Each unit as a multiple of its dimension's base unit (piece, kg, m, m2, l). Factors are exact decimals. */
const UNITS: Record<string, { dim: 'count' | 'mass' | 'length' | 'area' | 'volume'; factor: string; name: string }> = {
  PCS: { dim: 'count', factor: '1', name: 'pieces' },
  DZ: { dim: 'count', factor: '12', name: 'dozens' },
  GR: { dim: 'count', factor: '144', name: 'gross' },
  PR: { dim: 'count', factor: '2', name: 'pairs' },
  KG: { dim: 'mass', factor: '1', name: 'kg' },
  G: { dim: 'mass', factor: '0.001', name: 'g' },
  T: { dim: 'mass', factor: '1000', name: 'tonnes' },
  LB: { dim: 'mass', factor: '0.45359237', name: 'lb' },
  OZ: { dim: 'mass', factor: '0.028349523', name: 'oz' },
  M: { dim: 'length', factor: '1', name: 'm' },
  CM: { dim: 'length', factor: '0.01', name: 'cm' },
  MM: { dim: 'length', factor: '0.001', name: 'mm' },
  FT: { dim: 'length', factor: '0.3048', name: 'ft' },
  YD: { dim: 'length', factor: '0.9144', name: 'yd' },
  IN: { dim: 'length', factor: '0.0254', name: 'in' },
  M2: { dim: 'area', factor: '1', name: 'm2' },
  FT2: { dim: 'area', factor: '0.09290304', name: 'ft2' },
  L: { dim: 'volume', factor: '1', name: 'l' },
  ML: { dim: 'volume', factor: '0.001', name: 'ml' },
  M3: { dim: 'volume', factor: '1000', name: 'm3' },
  GAL: { dim: 'volume', factor: '3.785411784', name: 'US gal' },
};

const ALIASES: Record<string, string> = {
  PC: 'PCS', PCE: 'PCS', PIECE: 'PCS', PIECES: 'PCS', EA: 'PCS', EACH: 'PCS', UNIT: 'PCS', UNITS: 'PCS', U: 'PCS', NOS: 'PCS', NO: 'PCS', NMB: 'PCS', C62: 'PCS', H87: 'PCS',
  DOZ: 'DZ', DOZEN: 'DZ', DZN: 'DZ', GRO: 'GR', PAIR: 'PR', PAIRS: 'PR', PRS: 'PR',
  KGS: 'KG', KILO: 'KG', KILOS: 'KG', KGM: 'KG', GRAM: 'G', GRAMS: 'G', GRM: 'G', MT: 'T', TNE: 'T', TON: 'T', TONNE: 'T', TONNES: 'T',
  LBS: 'LB', LBR: 'LB', POUND: 'LB', POUNDS: 'LB', ONZ: 'OZ',
  MTR: 'M', METER: 'M', METERS: 'M', METRE: 'M', METRES: 'M', CMT: 'CM', MMT: 'MM', FOT: 'FT', FEET: 'FT', FOOT: 'FT', YDS: 'YD', YARD: 'YD', YARDS: 'YD', INH: 'IN', INCH: 'IN',
  SQM: 'M2', MTK: 'M2', SQFT: 'FT2', FTK: 'FT2',
  LTR: 'L', LITRE: 'L', LITER: 'L', LITRES: 'L', LITERS: 'L', MLT: 'ML', CBM: 'M3', MTQ: 'M3', GLL: 'GAL', GALLON: 'GAL', GALLONS: 'GAL',
};

/** The canonical code of a unit as printed ("pcs.", "Each", "KGS"), or the cleaned text when unknown. */
export function canonicalUnit(raw: string): string {
  const u = raw.toUpperCase().replace(/[.\s]+/g, '');
  return ALIASES[u] ?? u;
}

/** Factor turning `from` into `to` as a fixed-point ratio [numerator, denominator], or null when they do not convert. */
export function unitRatio(from: string, to: string): [bigint, bigint] | null {
  const a = UNITS[canonicalUnit(from)];
  const b = UNITS[canonicalUnit(to)];
  if (!a || !b || a.dim !== b.dim) return null;
  return [toFixed(a.factor), toFixed(b.factor)];
}

export const unitName = (raw: string): string => UNITS[canonicalUnit(raw)]?.name ?? raw;

// Dates ------------------------------------------------------------------------------------------

/** Whole days from `b` to `a` (YYYY-MM-DD, or the date part of a date-time). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** True when the string carries a time, not just a date. */
export const hasTime = (v: string): boolean => /T\d{2}:\d{2}/.test(v);

/** Milliseconds since the epoch; a time without a zone is read as UTC, so a run does not depend on the server's zone. */
export function instant(v: string): number {
  if (!hasTime(v)) return Date.parse(`${v}T00:00:00Z`);
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v}Z`);
}
