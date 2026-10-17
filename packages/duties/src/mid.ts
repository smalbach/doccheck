import type { Party } from '@doccheck/schemas';

/** Canadian manufacturers use their province code in place of the country (CBP MID instructions). */
const CA_PROVINCES: Record<string, string> = { AB: 'XA', BC: 'XC', MB: 'XM', NB: 'XB', NL: 'XW', NS: 'XN', NT: 'XT', NU: 'XV', ON: 'XO', PE: 'XP', QC: 'XQ', SK: 'XS', YT: 'XY' };
const SKIPPED = new Set(['A', 'AN', 'AND', 'OF', 'THE']);

const letters = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/**
 * CBP manufacturer identification code (MID, 7501 box 13 and line level), built the way CBP's
 * instructions describe: country (or Canadian province) code, the first three letters of the first
 * two words of the name (skipping A, An, And, Of, The), the first four digits of the largest
 * number in the street address, and the first three letters of the city.
 *
 *   Rodex Leather Co., Ltd., 1234 Industrial Road, Ho Chi Minh City, VN → VNRODLEA1234HOC
 *
 * Returns undefined when the country is unknown. It is a draft: the importer confirms it.
 */
export function manufacturerId(party: Party): string | undefined {
  const country = party.address.country;
  if (!country) return undefined;
  const region = party.address.region?.toUpperCase();
  const prefix = country === 'CA' ? (region && CA_PROVINCES[region]) || 'CA' : country;
  const words = letters(party.name)
    .replace(/-/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SKIPPED.has(w));
  const name = words.slice(0, 2).map((w) => w.replace(/[^A-Z]/g, '').slice(0, 3)).join('');
  const numbers = party.address.lines.join(' ').match(/\d+/g) ?? [];
  const largest = numbers.reduce((best, n) => (BigInt(n) > BigInt(best || '0') ? n : best), '');
  const city = letters(party.address.city ?? '').replace(/[^A-Z]/g, '').slice(0, 3);
  return `${prefix}${name}${largest.slice(0, 4)}${city}`;
}
