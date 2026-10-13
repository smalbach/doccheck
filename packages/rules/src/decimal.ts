/**
 * Minimal fixed-point arithmetic on decimal strings, so money and weights never touch floats.
 * Values are scaled to SCALE decimal places and held as BigInt.
 */
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export function toFixed(value: string): bigint {
  const negative = value.startsWith('-');
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const frac = (fracPart + '0'.repeat(SCALE)).slice(0, SCALE);
  const result = BigInt(intPart || '0') * FACTOR + BigInt(frac || '0');
  return negative ? -result : result;
}

export function fromFixed(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(SCALE - decimals);
  const rounded = (abs + unit / 2n) / unit; // round half up
  const divisor = 10n ** BigInt(decimals);
  const intPart = rounded / divisor;
  const fracPart = (rounded % divisor).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${intPart}${decimals > 0 ? '.' + fracPart : ''}`;
}

export const mul = (a: string, b: string): bigint => (toFixed(a) * toFixed(b)) / FACTOR;
export const sum = (values: string[]): bigint => values.reduce((acc, v) => acc + toFixed(v), 0n);

/** Compares two decimals after rounding both to `decimals` places. */
export const equalRounded = (a: bigint, b: bigint, decimals = 2): boolean => fromFixed(a, decimals) === fromFixed(b, decimals);

/** True when |a - b| <= tolerance * max(|a|, |b|). Tolerance is a fraction: 0.01 = 1%. */
export function withinTolerance(a: string, b: string, tolerance: number): boolean {
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const x = toFixed(a);
  const y = toFixed(b);
  const base = abs(x) > abs(y) ? abs(x) : abs(y);
  const tol = BigInt(Math.round(tolerance * 1_000_000));
  return abs(x - y) * 1_000_000n <= base * tol;
}
