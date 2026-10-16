/** Adds amounts with two decimals ("12.50") as integers of cents, so display sums never go through floats. */
export function addCents(...values: string[]): string {
  const cents = (v: string) => {
    const [i, f = ''] = v.replace('-', '').split('.');
    const c = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
    return v.startsWith('-') ? -c : c;
  };
  const s = values.reduce((acc, v) => acc + cents(v), 0n);
  const abs = s < 0n ? -s : s;
  return `${s < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
