const PREFIX_ORDER = ['X', 'A', 'C', 'U'];

/** Cross-document rules first (X1, X2 … X12), then agent (A), Canada (C) and US (U) rules; numbers compare as numbers. */
export function compareRuleIds(a: string, b: string): number {
  const rank = (id: string) => {
    const i = PREFIX_ORDER.indexOf(id.charAt(0));
    return i === -1 ? PREFIX_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true });
}
