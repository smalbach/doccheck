import type { Destination, Finding } from '@doccheck/schemas';
import { nameTokens } from './text';

/**
 * Names of the Xinjiang Uyghur Autonomous Region and its prefectures and main cities, in pinyin
 * and in the Uyghur-derived spellings documents use. A party whose name or address has one of
 * them ties the goods to the region UFLPA presumes uses forced labor.
 */
export const XINJIANG_TERMS = new Set([
  'XINJIANG', 'XUAR', 'URUMQI', 'URUMCHI', 'WULUMUQI', 'KASHGAR', 'KASHI', 'HOTAN', 'KHOTAN', 'HETIAN', 'AKESU', 'KORLA', 'KUERLE',
  'TURPAN', 'TULUFAN', 'KUMUL', 'YINING', 'GHULJA', 'KARAMAY', 'KELAMAYI', 'SHIHEZI', 'CHANGJI', 'BAYINGOLIN', 'BAYINGUOLENG',
  'TACHENG', 'BORTALA', 'BOERTALA', 'KIZILSU', 'KEZILESU', 'BINGTUAN', 'XPCC',
]);

/** Place names also found outside Xinjiang (Aksu in Turkey, Altay in Russia): they count only when the party is in China. */
export const XINJIANG_TERMS_IN_CHINA = new Set(['AKSU', 'ALTAY', 'ALETAI', 'HAMI', 'ILI', 'YILI', 'TUMXUK', 'ARAL', 'ALAR']);

/** The Xinjiang place a text names, if any. */
export function xinjiangTerm(text: string, inChina: boolean): string | undefined {
  const tokens = nameTokens(text);
  return tokens.find((t) => XINJIANG_TERMS.has(t)) ?? (inChina ? tokens.find((t) => XINJIANG_TERMS_IN_CHINA.has(t)) : undefined);
}

/**
 * HS headings in the sectors CBP's UFLPA enforcement gives high priority to, by prefix of the
 * code's digits. Extend the table to watch more sectors.
 */
export const HIGH_RISK_HS: { prefix: string; sector: string }[] = [
  { prefix: '52', sector: 'cotton' },
  { prefix: '61', sector: 'cotton apparel (knitted)' },
  { prefix: '62', sector: 'cotton apparel (woven)' },
  { prefix: '280461', sector: 'polysilicon' },
  { prefix: '0702', sector: 'tomatoes' },
  { prefix: '2002', sector: 'tomato products' },
];

export function highRiskSector(hsCode: string | undefined): { prefix: string; sector: string } | undefined {
  const digits = hsCode?.replace(/\D/g, '') ?? '';
  return digits ? HIGH_RISK_HS.find((h) => digits.startsWith(h.prefix)) : undefined;
}

/** The legal basis S3 cites, per destination. */
export const FORCED_LABOUR_BASIS: Record<Destination, NonNullable<Finding['regulation']>> = {
  US: {
    title: 'Uyghur Forced Labor Prevention Act (Public Law 117-78), section 3(a): rebuttable presumption',
    url: 'https://www.congress.gov/117/plaws/publ78/PLAW-117publ78.pdf',
    effectiveDate: '2022-06-21',
    excerpt:
      'The Commissioner of U.S. Customs and Border Protection shall, except as provided by subsection (b), apply a presumption that any goods, wares, articles, and merchandise mined, produced, or manufactured wholly or in part in the Xinjiang Uyghur Autonomous Region of the People’s Republic of China or produced by an entity on a list required by clause (i), (ii), (iv), or (v) of section 2(d)(2)(B) of this Act— (1) are prohibited from importation into the United States under section 307 of the Tariff Act of 1930 (19 U.S.C. 1307); and (2) are not entitled to entry to the United States.',
  },
  CA: {
    title: 'Customs Tariff, Schedule, tariff item 9897.00.00: goods produced by forced labour',
    url: 'https://laws-lois.justice.gc.ca/eng/acts/C-54.011/',
    excerpt:
      'Tariff item 9897.00.00 prohibits the importation into Canada of goods mined, manufactured or produced wholly or in part by forced labour or child labour. CBSA may detain such goods at the border; the US UFLPA presumption about Xinjiang does not apply in Canada, but the same supply-chain evidence answers both.',
  },
};
