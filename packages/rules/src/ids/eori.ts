/**
 * EORI number (Economic Operators Registration and Identification): a country code followed by an
 * identifier of up to 15 characters, unique in the customs territory (Regulation (EU) 2015/2447,
 * Article 6; Annex 12-01). Member states set the national part, so only the shape is checked here.
 */

/** EU member states as they prefix EORI numbers (Greece uses GR, not the VAT prefix EL). */
export const EU_EORI_PREFIXES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

/** Northern Ireland traders under the Windsor Framework hold an XI number alongside their GB one. */
export const NI_EORI_PREFIX = 'XI';

export const compactEori = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');

/** An EORI number valid for the EU customs territory: member state (or XI) + up to 15 letters or digits. */
export function isValidEuEori(raw: string): boolean {
  const e = compactEori(raw);
  const prefix = e.slice(0, 2);
  return ([...EU_EORI_PREFIXES, NI_EORI_PREFIX] as string[]).includes(prefix) && /^[A-Z0-9]{1,15}$/.test(e.slice(2));
}

/**
 * A UK EORI number: "A GB EORI has 12 digits and the prefix 'GB'" (HMRC EORI manual), a VAT registration
 * number plus a 3-digit suffix or an HMRC-issued number; an XI number has the same digits, for goods
 * moving into or out of Northern Ireland.
 */
export function isValidGbEori(raw: string): boolean {
  return /^(GB|XI)\d{12}$/.test(compactEori(raw));
}
