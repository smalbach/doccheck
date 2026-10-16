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
  MX: {
    title: 'Acuerdo de la Secretaría de Economía (DOF, 17 February 2023): goods produced with forced labour may not be imported',
    url: 'https://www.dof.gob.mx/',
    effectiveDate: '2023-05-18',
    excerpt:
      'Summary, not the text: since 18 May 2023 Mexico prohibits importing goods produced wholly or in part with forced or compulsory labour, including child labour, as its USMCA/T-MEC commitment (Article 23.6). The Xinjiang presumption of the US UFLPA does not apply in Mexico, but the same supply-chain evidence answers both.',
  },
  EU: {
    title: 'Regulation (EU) 2024/3015 prohibiting products made with forced labour on the Union market',
    url: 'https://eur-lex.europa.eu/eli/reg/2024/3015/oj',
    effectiveDate: '2027-12-14',
    excerpt:
      'Summary, not the text: products made with forced labour may not be placed or made available on the Union market, nor exported; authorities investigate on a risk basis and customs withhold products covered by a decision. It applies from 14 December 2027; until then the risk is one for due diligence and customers, not yet a border ban.',
  },
  GB: {
    title: 'Modern Slavery Act 2015, section 54: transparency in supply chains',
    url: 'https://www.legislation.gov.uk/ukpga/2015/30/section/54',
    excerpt:
      'Summary, not the text: the UK has no import ban on goods made with forced labour; larger businesses publish an annual statement of the steps taken to keep slavery and human trafficking out of their supply chains. Goods from these sectors and regions are where buyers and auditors look first.',
  },
};

/** What to do about an S3 finding, per destination. */
export const FORCED_LABOUR_ACTION: Record<Destination, string> = {
  US: 'Before shipping, get supply-chain tracing documents down to the raw material (UFLPA operational guidance), or expect CBP to detain the goods.',
  CA: 'Ask the supplier for supply-chain tracing documents down to the raw material; CBSA may detain goods suspected of forced labour.',
  MX: 'Ask the supplier for supply-chain tracing documents down to the raw material; the Secretaría de Economía may refuse goods made with forced labour.',
  EU: 'Ask the supplier for supply-chain tracing documents down to the raw material, ahead of the EU forced labour ban (December 2027).',
  GB: 'Ask the supplier for supply-chain tracing documents down to the raw material for your Modern Slavery Act due diligence.',
};
