/**
 * Fixed-point decimals for money, rates and quantities: values are BigInt scaled to 12 decimal
 * places, so a duty never goes through a JavaScript float. Rates such as 0.3464 % or an exchange
 * rate of 1.3712 multiply exactly; results are rounded half up only when formatted or `round`ed.
 */
export type Fixed = bigint;

const SCALE = 12;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const ZERO: Fixed = 0n;
export const ONE: Fixed = FACTOR;
export const HUNDRED: Fixed = 100n * FACTOR;

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value);
}

/** "1,234.50" is not accepted: values reach here already normalized ("1234.50"). */
export function dec(value: string | number | bigint): Fixed {
  if (typeof value === 'bigint') return value * FACTOR;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`dec(${value}): pass fractional values as strings`);
    return BigInt(value) * FACTOR;
  }
  const v = value.trim();
  if (!DECIMAL.test(v)) throw new Error(`Not a decimal: "${value}"`);
  const negative = v.startsWith('-');
  const [int, frac = ''] = v.replace('-', '').split('.');
  const scaled = BigInt(int) * FACTOR + BigInt((frac + '0'.repeat(SCALE)).slice(0, SCALE) || '0');
  return negative ? -scaled : scaled;
}

/** Rounds half away from zero to `places` decimals, staying a Fixed. */
export function round(value: Fixed, places = 2): Fixed {
  const unit = 10n ** BigInt(SCALE - places);
  const abs = value < 0n ? -value : value;
  const rounded = ((abs + unit / 2n) / unit) * unit;
  return value < 0n ? -rounded : rounded;
}

/** Rounds up (away from zero) to `places` decimals. */
export function ceil(value: Fixed, places = 2): Fixed {
  const unit = 10n ** BigInt(SCALE - places);
  const abs = value < 0n ? -value : value;
  const up = ((abs + unit - 1n) / unit) * unit;
  return value < 0n ? -up : up;
}

export function fmt(value: Fixed, places = 2): string {
  const r = round(value, places);
  const abs = r < 0n ? -r : r;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0').slice(0, places);
  return `${r < 0n ? '-' : ''}${int}${places > 0 ? '.' + frac : ''}`;
}

/** Shortest form, for rates: 0.346400 → "0.3464", 25.000 → "25". */
export function fmtRate(value: Fixed): string {
  return fmt(value, 6).replace(/\.?0+$/, '');
}

export const add = (...values: Fixed[]): Fixed => values.reduce((a, b) => a + b, 0n);
export const sub = (a: Fixed, b: Fixed): Fixed => a - b;

/** a × b, rounded half away from zero at the 12th decimal. */
export function mul(a: Fixed, b: Fixed): Fixed {
  const p = a * b;
  const half = FACTOR / 2n;
  return p >= 0n ? (p + half) / FACTOR : -((-p + half) / FACTOR);
}

/** a ÷ b, rounded half away from zero at the 12th decimal. */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new Error('Division by zero');
  const n = a * FACTOR;
  const negative = n < 0n !== b < 0n;
  const absN = n < 0n ? -n : n;
  const absB = b < 0n ? -b : b;
  const q = (absN + absB / 2n) / absB;
  return negative ? -q : q;
}

/** `percent` % of value: pct(1000, 2.5) = 25. */
export const pct = (value: Fixed, percent: Fixed): Fixed => div(mul(value, percent), HUNDRED);

export const max = (a: Fixed, b: Fixed): Fixed => (a > b ? a : b);
export const min = (a: Fixed, b: Fixed): Fixed => (a < b ? a : b);
export const clamp = (value: Fixed, lo: Fixed, hi: Fixed): Fixed => min(max(value, lo), hi);
export const sum = (values: Fixed[]): Fixed => values.reduce((a, b) => a + b, 0n);

/**
 * Splits `total` (already rounded to `places`) over `weights` in proportion, so the parts are
 * rounded to `places` and add up to the total exactly (largest remainder). Zero weights get zero;
 * all-zero weights split evenly.
 */
export function allocate(total: Fixed, weights: Fixed[], places = 2): Fixed[] {
  if (weights.length === 0) return [];
  const unit = 10n ** BigInt(SCALE - places);
  const units = round(total, places) / unit;
  const w = weights.every((x) => x === 0n) ? weights.map(() => 1n) : weights.map((x) => (x < 0n ? 0n : x));
  const totalWeight = sum(w);
  const negative = units < 0n;
  const absUnits = negative ? -units : units;
  const raw = w.map((x) => absUnits * x);
  const parts = raw.map((r) => r / totalWeight);
  let left = absUnits - sum(parts);
  const order = raw.map((r, i) => ({ i, rem: r % totalWeight })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i] += 1n;
    left -= 1n;
  }
  return parts.map((p) => (negative ? -p : p) * unit);
}
