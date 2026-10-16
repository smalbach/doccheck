import type { Destination } from '@doccheck/schemas';

/** Where a table comes from. Every estimate lists the tables it used with this header. */
export interface TableMeta {
  table: string;
  source: string;
  url?: string;
  /** Tariff release ("2026HTSRev21"), or the version of a hand-edited table ("2026-10-16.1"). */
  revision?: string;
  version?: string;
  effectiveDate?: string;
  /** Hand-edited tables: the date the data was checked, and the last date it is known to hold. */
  dataDate?: string;
  validThrough?: string;
  retrievedAt?: string;
  scope?: string;
  note?: string;
}

/** HTSUS row: [code, indent, description, units, general, special, column 2, footnotes?]. Code "" is a group heading. */
export type UsHtsRow = [string, number, string, string, string, string, string, string?];
export interface UsHtsTable {
  meta: TableMeta;
  rows: UsHtsRow[];
}

/** Customs Tariff row: [code, description, unit of measure, effective date, rates by tariff treatment]. */
export type CaTariffRow = [string, string, string, string, Record<string, string>];
export interface CaTariffTable {
  meta: TableMeta & { treatments?: string[] };
  rows: CaTariffRow[];
}

/** Bank of Canada: CAD per unit of each currency, per business day. */
export interface FxCaTable {
  meta: TableMeta;
  rows: [string, Record<string, string>][];
}

/** Federal Reserve H.10, in the published direction per currency. */
export interface FxUsTable {
  meta: TableMeta;
  rows: [string, Record<string, { usdPerUnit?: string; unitsPerUsd?: string }>][];
}

/**
 * An additional duty on top of the tariff rate: Section 301, 232, 122 in the US, surtaxes in
 * Canada. Hand-edited and dated, because these change by notice.
 */
export interface AdditionalDuty {
  id: string;
  program: string;
  /** Chapter 99 heading (US) or the order (CA) that imposes it. */
  heading?: string;
  description: string;
  /** ISO countries of origin it applies to; ["*"] = every origin not excluded. */
  origins: string[];
  excludeOrigins?: string[];
  /** HS prefixes (digits, any length) it covers; ["*"] = all goods. */
  hs: string[];
  excludeHs?: string[];
  /**
   * adValorem: percent of the line's value. topUpTo: whatever brings the total of the regular rate
   * and this one to `percent` (EU-style "at least 10 % in total, including the regular duty").
   */
  kind: 'adValorem' | 'topUpTo';
  percent: string;
  /** value: the whole line value. metalContent: only the value of the steel or aluminium in it. */
  basis?: 'value' | 'metalContent';
  /** Entries of these groups do not stack with this one (e.g. 301 forced labour does not apply to 232 goods). */
  group?: string;
  notWith?: string[];
  /** Not charged when the line enters under one of these preference programs (US "S" = USMCA). */
  exemptUnderPrograms?: string[];
  effectiveFrom: string;
  effectiveTo?: string | null;
  source: string;
  url?: string;
  /** False when the coverage or rate was not checked against the official list: the estimate says so. */
  verified: boolean;
  note?: string;
}

export interface AdditionalDutyTable {
  meta: TableMeta;
  /** Origins whose additional duties this table is meant to cover completely as of dataDate. */
  originsReviewed: string[];
  entries: AdditionalDuty[];
}

export interface MpfPeriod {
  from: string;
  to: string;
  percent: string;
  minimum: string;
  maximum: string;
  source: string;
}

export interface UsFeesTable {
  meta: TableMeta;
  mpf: MpfPeriod[];
  hmf: { from: string; to?: string | null; percent: string; modes: string[]; source: string }[];
  informalEntryLimit: string;
}

export interface CaTaxRate {
  province: string;
  name: string;
  /** Harmonized sales tax (total, including the 5 % federal part), or undefined for GST-only provinces. */
  hst?: string;
  /** Provincial sales tax not collected at the border on commercial goods (PST, QST, RST). */
  pst?: { name: string; percent: string };
  from: string;
  to?: string | null;
}

export interface CaTaxTable {
  meta: TableMeta;
  gst: { percent: string; from: string; source: string };
  provinces: CaTaxRate[];
  /** Chapters (2 digits) where excise duty or tax may apply on top: flagged, not computed. */
  exciseChapters: { chapter: string; note: string }[];
}

export interface AdCvdCase {
  id: string;
  destination: Destination;
  /** Case number (A-570-108, C-570-109) or the SIMA measure. */
  caseNumber: string;
  product: string;
  kind: 'AD' | 'CVD' | 'SIMA';
  origins: string[];
  hs: string[];
  since: string;
  until?: string | null;
  url?: string;
  verified: boolean;
}

export interface AdCvdTable {
  meta: TableMeta;
  cases: AdCvdCase[];
}

/** A free trade agreement, and how each destination applies it. */
export interface Agreement {
  id: string;
  name: string;
  /** CA: tariff treatment per origin country (CUSMA: US → UST, MX → MXT). */
  CA?: { treatments: Record<string, string> };
  /** US: HTSUS special program code and the origins it covers. */
  US?: { program: string; origins: string[] };
  /** "cusma": the 9 minimum data elements of CUSMA Annex 5-A are checked. */
  certification: 'cusma' | 'cptpp' | 'certificate' | 'origin-statement';
  proof: string;
}

export interface FtaTable {
  meta: TableMeta;
  agreements: Agreement[];
  /** CA tariff treatment names and CAD codes. */
  caTreatments: Record<string, { name: string; code?: string }>;
  /** CUSMA product-specific rule hints by chapter range: a pointer, not the rule. */
  cusmaHints: { chapters: [string, string]; hint: string }[];
  cusmaDefaultHint: string;
}

export interface DutyTables {
  usHts: UsHtsTable;
  caTariff: CaTariffTable;
  fxCa: FxCaTable;
  fxUs: FxUsTable;
  usAdditional: AdditionalDutyTable;
  caAdditional: AdditionalDutyTable;
  usFees: UsFeesTable;
  caTaxes: CaTaxTable;
  adcvd: AdCvdTable;
  fta: FtaTable;
}

/** The header of each table, as listed in an estimate ("which data, from when"). */
export function tableSources(t: DutyTables, destination: Destination): TableMeta[] {
  const shared = [t.adcvd.meta, t.fta.meta];
  return destination === 'US'
    ? [t.usHts.meta, t.usAdditional.meta, t.usFees.meta, t.fxUs.meta, ...shared]
    : [t.caTariff.meta, t.caAdditional.meta, t.caTaxes.meta, t.fxCa.meta, ...shared];
}
