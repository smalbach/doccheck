import { add, dec, div, fmtRate, type Fixed, max, min, mul, pct } from './decimal';

/** Unit a specific rate is charged per, normalized: "kg", "l", "no", "doz", "pr", "m2", "m3", "t". */
export type RateUnit = string;

/**
 * A duty rate as printed in the tariff ("9%", "5¢/kg", "1.5¢/kg + 5%", "18 %", "4.68 ¢/litre",
 * "9.5% but not less than 4.62¢/kg"), parsed into parts. Amounts are in the tariff's own currency
 * (USD for the HTSUS, CAD for the Customs Tariff). A text the parser does not understand stays
 * `unparsed`, and the estimate says so instead of guessing.
 */
export interface Rate {
  text: string;
  free?: boolean;
  /** Ad valorem part, in percent. */
  percent?: Fixed;
  /** Specific part: amount per unit. */
  specific?: { amount: Fixed; per: RateUnit };
  /** "but not less than" / "but not more than" a specific amount. */
  minimum?: { amount: Fixed; per: RateUnit };
  maximum?: { amount: Fixed; per: RateUnit };
  unparsed?: boolean;
}

const UNIT_ALIASES: Record<string, RateUnit> = {
  kg: 'kg', kgm: 'kg', 'kg.': 'kg',
  liter: 'l', litre: 'l', l: 'l', ltr: 'l',
  'no.': 'no', no: 'no', each: 'no', nmb: 'no', pcs: 'no', pc: 'no', ea: 'no', unit: 'no', units: 'no', set: 'no', sets: 'no', nmp: 'pr',
  'doz.': 'doz', doz: 'doz', dozen: 'doz', dpr: 'doz',
  'pr.': 'pr', pr: 'pr', pair: 'pr', prs: 'pr', pairs: 'pr',
  m2: 'm2', 'm²': 'm2', mtk: 'm2', sqm: 'm2',
  m3: 'm3', 'm³': 'm3', mtq: 'm3', cbm: 'm3',
  t: 't', tonne: 't', tne: 't', ton: 't',
  m: 'm', mtr: 'm',
};

/** Normalizes a unit from a tariff, a rate or an invoice ("KGM", "PCS", "No.", "litre") to a RateUnit. */
export function normalizeUnit(unit: string | undefined): RateUnit | undefined {
  if (!unit) return undefined;
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? UNIT_ALIASES[key.replace(/\.$/, '')];
}

const PERCENT = /^(\d+(?:\.\d+)?)\s*%$/;
// 5¢/kg · 4.68 ¢/litre · $1.035/kg · $2.50/kg · 1.5 ¢/kg on contents and container
const SPECIFIC = /^(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*¢)\s*\/\s*([a-zA-Z²³.]+)(?:\s+on\s+contents\s+and\s+container)?$/;

function parseSpecific(s: string): { amount: Fixed; per: RateUnit } | undefined {
  const m = SPECIFIC.exec(s.trim());
  if (!m) return undefined;
  const per = normalizeUnit(m[3]);
  if (!per) return undefined;
  // Cents are divided by 100 exactly: 5¢ = 0.05.
  const amount = m[1] !== undefined ? dec(m[1]) : div(dec(m[2]), dec(100));
  return { amount, per };
}

/** Parses one rate as printed. Footnote marks ("Free¹", "9%*") are ignored. */
export function parseRate(text: string): Rate {
  const t = text.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*]+$/u, '').replace(/\s+/g, ' ').trim();
  if (/^free$/i.test(t)) return { text, free: true };
  const p = PERCENT.exec(t);
  if (p) return { text, percent: dec(p[1]) };
  const sp = parseSpecific(t);
  if (sp) return { text, specific: sp };
  // Compound: "1.5¢/kg + 5%" or "5% + 1.5¢/kg".
  const compound = t.split(/\s*\+\s*/);
  if (compound.length === 2) {
    const [a, b] = compound;
    const pa = PERCENT.exec(a);
    const pb = PERCENT.exec(b);
    const sa = parseSpecific(a);
    const sb = parseSpecific(b);
    if (sa && pb) return { text, specific: sa, percent: dec(pb[1]) };
    if (pa && sb) return { text, percent: dec(pa[1]), specific: sb };
  }
  // "9.5% but not less than 4.62¢/kg", "6.5% but not more than $1.25/kg"
  const bounded = /^(\d+(?:\.\d+)?)\s*%\s+but\s+not\s+(less|more)\s+than\s+(.+)$/i.exec(t);
  if (bounded) {
    const bound = parseSpecific(bounded[3]);
    if (bound) return { text, percent: dec(bounded[1]), ...(bounded[2].toLowerCase() === 'less' ? { minimum: bound } : { maximum: bound }) };
  }
  return { text, unparsed: true };
}

export interface SpecialRate {
  rate: Rate;
  programs: string[];
}

/** HTSUS special column: "Free (A+,AU,B,BH,CL) 3.1% (JP)" → one entry per rate, with its program codes. */
export function parseSpecialColumn(text: string): SpecialRate[] {
  const out: SpecialRate[] = [];
  const re = /([^()]+?)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const programs = m[2].split(',').map((p) => p.trim()).filter(Boolean);
    out.push({ rate: parseRate(m[1].trim()), programs });
  }
  return out;
}

/** HTSUS program codes carry marks: "A+", "A*" (GSP with exclusions), "E*". The base code is the letters. */
export const programCode = (code: string): string => code.replace(/[^A-Z]/g, '');

export interface RateApplication {
  /** Undefined when the rate cannot be applied (unparsed text, or the quantity in the rate's unit is missing). */
  amount?: Fixed;
  missingUnit?: RateUnit;
  unparsed?: boolean;
}

/**
 * Applies a rate to a value (in the tariff's currency) and quantities by unit. Not rounded: the
 * caller rounds the line's duty once.
 */
export function applyRate(rate: Rate, value: Fixed, quantities: Partial<Record<RateUnit, Fixed>>): RateApplication {
  if (rate.unparsed) return { unparsed: true };
  if (rate.free) return { amount: 0n };
  let amount: Fixed = 0n;
  if (rate.percent !== undefined) amount = add(amount, pct(value, rate.percent));
  if (rate.specific) {
    const q = quantities[rate.specific.per];
    if (q === undefined) return { missingUnit: rate.specific.per };
    amount = add(amount, mul(rate.specific.amount, q));
  }
  for (const [bound, pick] of [
    [rate.minimum, max],
    [rate.maximum, min],
  ] as const) {
    if (!bound) continue;
    const q = quantities[bound.per];
    if (q === undefined) return { missingUnit: bound.per };
    amount = pick(amount, mul(bound.amount, q));
  }
  return { amount };
}

/** Short label for a rate, e.g. "9%", "Free", "$0.05/kg". */
export function rateLabel(rate: Rate): string {
  if (rate.free) return 'Free';
  if (rate.unparsed) return rate.text;
  const parts: string[] = [];
  if (rate.specific) parts.push(`${fmtRate(rate.specific.amount)}/${rate.specific.per}`);
  if (rate.percent !== undefined) parts.push(`${fmtRate(rate.percent)}%`);
  let label = parts.join(' + ');
  if (rate.minimum) label += ` (min ${fmtRate(rate.minimum.amount)}/${rate.minimum.per})`;
  if (rate.maximum) label += ` (max ${fmtRate(rate.maximum.amount)}/${rate.maximum.per})`;
  return label;
}
