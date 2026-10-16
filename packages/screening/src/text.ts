import { normalizeName } from '@doccheck/rules';

/**
 * Name normalization for screening. Starts from the normalization behind rule X1 (case, accents,
 * punctuation, legal form) and also drops the legal forms and filler words that sanctions lists
 * print and invoices do not (OOO, FZE, SDN BHD, "the", "of"...), which carry no identity.
 */
const MORE_LEGAL_FORMS = new Set(
  'OOO OAO ZAO PAO AO TOO PJSC OJSC CJSC PRIVATE LLP FZE FZCO FZC DMCC BHD SDN PTE PT SRL SARL BV NV AG KG KFT SPA SPZOO ZOO OY AB AS GIE EIRL SL SAU TIC LTDA CIA YOUXIAN GONGSI ZEREN'.split(' '),
);
const FILLER = new Set('THE AND OF DE LA LE DU DES DEL DA DI VON VAN AL EL'.split(' '));

/** Tokens of a name, in order: "Hetian Taida Apparel Co., Ltd" -> ["HETIAN", "TAIDA", "APPAREL"]. */
export function nameTokens(name: string): string[] {
  // Dotted abbreviations are one word: "S.A." -> "SA", "L.L.C." -> "LLC".
  const joined = normalizeName(name.replace(/\b(?:[A-Za-z]\.\s?){2,}/g, (m) => `${m.replace(/[.\s]/g, '')} `));
  const tokens = joined.split(' ').filter((t) => t.length > 1 && !MORE_LEGAL_FORMS.has(t) && !FILLER.has(t));
  // A name made only of filler or initials ("THE COMPANY") keeps what it has rather than vanish.
  return tokens.length > 0 ? tokens : joined.split(' ').filter(Boolean);
}

/** Mostly Latin letters: names in other scripts cannot be compared with what an invoice prints. */
export const isLatin = (s: string) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.filter((c) => /[A-Za-z\u00C0-\u024F]/.test(c)).length / letters.length >= 0.5;
};

/** The name to show for an entry: its first name in Latin script. */
export const displayName = (e: { name: string; aliases: string[] }) => [e.name, ...e.aliases].find(isLatin) ?? e.name;

/** The key two spellings of one party share: tokens sorted, so "ABU TEIR, Mohammed" == "Mohammed Abu Teir". */
export function partyKey(name: string): string {
  return [...nameTokens(name)].sort().join(' ');
}

/** Jaro similarity of two strings, 0..1. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const matchedA = new Array<boolean>(la).fill(false);
  const matchedB = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const from = Math.max(0, i - window);
    const to = Math.min(lb - 1, i + window);
    for (let j = from; j <= to; j++) {
      if (matchedB[j] || a[i] !== b[j]) continue;
      matchedA[i] = matchedB[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!matchedA[i]) continue;
    while (!matchedB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro-Winkler: Jaro with a bonus for a common prefix of up to 4 characters (p = 0.1). */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/** Country names as the lists print them, in English and French, to ISO alpha-2. */
const COUNTRY_ALIASES: Record<string, string> = {
  RUSSIA: 'RU', 'RUSSIAN FEDERATION': 'RU', IRAN: 'IR', 'IRAN ISLAMIC REPUBLIC OF': 'IR', SYRIA: 'SY', 'SYRIAN ARAB REPUBLIC': 'SY',
  'NORTH KOREA': 'KP', 'KOREA NORTH': 'KP', "DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA": 'KP', 'DEMOCRATIC PEOPLES REPUBLIC OF KOREA': 'KP', DPRK: 'KP',
  'SOUTH KOREA': 'KR', 'KOREA SOUTH': 'KR', 'REPUBLIC OF KOREA': 'KR', KOREA: 'KR', BURMA: 'MM', MYANMAR: 'MM', 'VIET NAM': 'VN', VIETNAM: 'VN',
  CHINA: 'CN', "PEOPLE'S REPUBLIC OF CHINA": 'CN', 'PEOPLES REPUBLIC OF CHINA': 'CN', PRC: 'CN', 'HONG KONG': 'HK', MACAU: 'MO', MACAO: 'MO', TAIWAN: 'TW',
  'UNITED KINGDOM': 'GB', UK: 'GB', 'UNITED STATES': 'US', USA: 'US', 'UNITED ARAB EMIRATES': 'AE', UAE: 'AE', TURKEY: 'TR', TURKIYE: 'TR',
  'CONGO DEMOCRATIC REPUBLIC OF THE': 'CD', 'DEMOCRATIC REPUBLIC OF THE CONGO': 'CD', 'CONGO REPUBLIC OF THE': 'CG', 'CZECH REPUBLIC': 'CZ', CZECHIA: 'CZ',
  'WEST BANK': 'PS', GAZA: 'PS', PALESTINE: 'PS', 'PALESTINIAN TERRITORIES': 'PS', CRIMEA: 'UA', 'BOLIVIA': 'BO', VENEZUELA: 'VE', LAOS: 'LA',
  "LAO PEOPLE'S DEMOCRATIC REPUBLIC": 'LA', MOLDOVA: 'MD', TANZANIA: 'TZ', 'COTE D IVOIRE': 'CI', "COTE D'IVOIRE": 'CI', 'IVORY COAST': 'CI',
  'BOSNIA AND HERZEGOVINA': 'BA', 'NORTH MACEDONIA': 'MK', 'THE NETHERLANDS': 'NL', NETHERLANDS: 'NL', 'BRITISH VIRGIN ISLANDS': 'VG',
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’`]/g, "'")
    .replace(/[^A-Z' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let countryNames: Map<string, string> | undefined;

/** Every ISO region code Node's ICU names, keyed by its English and French names. Built once. */
function names(): Map<string, string> {
  if (countryNames) return countryNames;
  const map = new Map<string, string>();
  const displays = ['en', 'fr'].map((l) => new Intl.DisplayNames([l], { type: 'region' }));
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      for (const d of displays) {
        let name: string | undefined;
        try {
          name = d.of(code);
        } catch {
          name = undefined;
        }
        if (name && name !== code) map.set(fold(name), code);
      }
    }
  }
  for (const [name, code] of Object.entries(COUNTRY_ALIASES)) map.set(fold(name), code);
  countryNames = map;
  return map;
}

/**
 * "Belarus / Bélarus", "Iran (Islamic Republic of)", "CN" -> ISO alpha-2, or undefined when the
 * text is not a country we know (a region like "Crimea" maps to its country).
 */
export function countryCode(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const raw = text.trim();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  const map = names();
  for (const part of raw.split('/')) {
    const t = fold(part.replace(/\(([^)]*)\)/g, ' $1'));
    const hit = map.get(t) ?? map.get(t.replace(/^THE /, '')) ?? map.get(fold(part.replace(/\([^)]*\)/g, '')));
    if (hit) return hit;
  }
  return undefined;
}
