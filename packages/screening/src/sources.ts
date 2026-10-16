import { parseCsl } from './parse/csl';
import { parseEu } from './parse/eu';
import { parseOfac } from './parse/ofac';
import { parseSema } from './parse/sema';
import { parseUflpa } from './parse/uflpa';
import { parseUn } from './parse/un';
import type { ListEntry } from './types';

/** A list as shown to people: its name, who publishes it and where to read it. */
export interface ListInfo {
  id: string;
  name: string;
  publisher: string;
  page: string;
  /** What a match on it means for the importer, one sentence, for findings. */
  consequence: string;
}

export const LISTS: Record<string, ListInfo> = {
  'ofac-sdn': {
    id: 'ofac-sdn',
    name: 'OFAC Specially Designated Nationals and Blocked Persons List',
    publisher: 'U.S. Treasury, Office of Foreign Assets Control',
    page: 'https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists',
    consequence: 'US persons may not deal with a blocked party; property and interests in it must be blocked and reported to OFAC.',
  },
  'ofac-cons': {
    id: 'ofac-cons',
    name: 'OFAC Consolidated Sanctions List (non-SDN)',
    publisher: 'U.S. Treasury, Office of Foreign Assets Control',
    page: 'https://ofac.treasury.gov/consolidated-sanctions-list-non-sdn-lists',
    consequence: 'The party is under OFAC sanctions short of blocking (sectoral, menu-based or other); check which program applies.',
  },
  'bis-el': {
    id: 'bis-el',
    name: 'BIS Entity List',
    publisher: 'U.S. Commerce, Bureau of Industry and Security',
    page: 'https://www.bis.gov/regulations/ear/744#supplement-4-744',
    consequence: 'Exports, reexports and transfers of items subject to the EAR to this party need a BIS license.',
  },
  'bis-dpl': {
    id: 'bis-dpl',
    name: 'BIS Denied Persons List',
    publisher: 'U.S. Commerce, Bureau of Industry and Security',
    page: 'https://www.bis.gov/licensing/guidance-on-end-user-and-end-use-controls-and-us-person-controls',
    consequence: 'The party has been denied export privileges; transactions involving items subject to the EAR are prohibited.',
  },
  'bis-uvl': {
    id: 'bis-uvl',
    name: 'BIS Unverified List',
    publisher: 'U.S. Commerce, Bureau of Industry and Security',
    page: 'https://www.bis.gov/licensing/guidance-on-end-user-and-end-use-controls-and-us-person-controls',
    consequence: 'BIS could not verify this party; exports to it need a UVL statement and added due diligence.',
  },
  'bis-meu': {
    id: 'bis-meu',
    name: 'BIS Military End-User List',
    publisher: 'U.S. Commerce, Bureau of Industry and Security',
    page: 'https://www.bis.gov/licensing/guidance-on-end-user-and-end-use-controls-and-us-person-controls',
    consequence: 'Exports of listed items to this military end user need a BIS license.',
  },
  'ca-sema': {
    id: 'ca-sema',
    name: 'Consolidated Canadian Autonomous Sanctions List (SEMA)',
    publisher: 'Global Affairs Canada',
    page: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng',
    consequence: 'Persons in Canada and Canadians abroad may not deal in property of a listed person or provide it goods or services.',
  },
  'un-sc': {
    id: 'un-sc',
    name: 'UN Security Council Consolidated List',
    publisher: 'United Nations Security Council',
    page: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list',
    consequence: 'Member states must apply the asset freeze, travel ban or arms embargo the Council imposed on this party.',
  },
  'eu-fsf': {
    id: 'eu-fsf',
    name: 'EU Consolidated Financial Sanctions List',
    publisher: 'European Commission (FSF)',
    page: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
    consequence: 'Funds and economic resources of the party are frozen in the EU and may not be made available to it.',
  },
  'dhs-uflpa': {
    id: 'dhs-uflpa',
    name: 'DHS UFLPA Entity List',
    publisher: 'U.S. Homeland Security, Forced Labor Enforcement Task Force',
    page: 'https://www.dhs.gov/uflpa-entity-list',
    consequence:
      'Goods produced by this entity are presumed made with forced labor and barred from entry into the US unless CBP grants an exception.',
  },
};

export const LIST_IDS = Object.keys(LISTS);

/** One download that builds one or more lists. */
export interface Source {
  id: string;
  /** Files to fetch, by name. */
  files: Record<string, string>;
  /** Raw files in, entries per list out (and the version date the files carry, if any). */
  build(files: Record<string, string>): { lists: Map<string, ListEntry[]>; versionDate?: string };
}

const OFAC = 'https://www.treasury.gov/ofac/downloads';

export const SOURCES: Source[] = [
  {
    id: 'ofac-sdn',
    files: { prim: `${OFAC}/sdn.csv`, add: `${OFAC}/add.csv`, alt: `${OFAC}/alt.csv` },
    build: (f) => ({ lists: new Map([['ofac-sdn', parseOfac('ofac-sdn', { prim: f.prim, add: f.add, alt: f.alt })]]) }),
  },
  {
    id: 'ofac-cons',
    files: { prim: `${OFAC}/consolidated/cons_prim.csv`, add: `${OFAC}/consolidated/cons_add.csv`, alt: `${OFAC}/consolidated/cons_alt.csv` },
    build: (f) => ({ lists: new Map([['ofac-cons', parseOfac('ofac-cons', { prim: f.prim, add: f.add, alt: f.alt })]]) }),
  },
  {
    id: 'trade-gov-csl',
    files: { csl: 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json' },
    build: (f) => ({ lists: parseCsl(f.csl) }),
  },
  {
    id: 'ca-sema',
    files: { xml: 'https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml' },
    build: (f) => {
      const entries = parseSema(f.xml);
      const versionDate = entries.reduce<string | undefined>((max, e) => (e.listedOn && (!max || e.listedOn > max) ? e.listedOn : max), undefined);
      return { lists: new Map([['ca-sema', entries]]), versionDate };
    },
  },
  {
    id: 'un-sc',
    files: { xml: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml' },
    build: (f) => {
      const { entries, versionDate } = parseUn(f.xml);
      return { lists: new Map([['un-sc', entries]]), versionDate };
    },
  },
  {
    id: 'eu-fsf',
    // The token is the public one the Commission publishes for this download.
    files: { csv: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw' },
    build: (f) => {
      const { entries, versionDate } = parseEu(f.csv);
      return { lists: new Map([['eu-fsf', entries]]), versionDate };
    },
  },
  {
    id: 'dhs-uflpa',
    files: { html: 'https://www.dhs.gov/uflpa-entity-list' },
    build: (f) => {
      const { entries, versionDate } = parseUflpa(f.html);
      return { lists: new Map([['dhs-uflpa', entries]]), versionDate };
    },
  },
];
