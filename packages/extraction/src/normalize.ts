import { fromFixed, mul, streetLines } from '@doccheck/rules';
import {
  Address,
  BillOfLading,
  CommercialInvoice,
  Container,
  Incoterm,
  Isf,
  Location,
  PackageGroup,
  PackingList,
  Party,
  TransportMode,
  type InvoiceLine,
  type Weight,
} from '@doccheck/schemas';
import type { z } from 'zod';
import type { RawBillOfLading, RawInvoice, RawIsf, RawPackingList, RawParty, RawPlace, RawWeight } from './raw-schemas';

/**
 * Printed text -> canonical values. Pure functions, no model involved: every conversion rule
 * (thousand separators, date formats, pounds to kilograms, country names) lives here and is tested.
 */

export interface NormalizeResult<T> {
  data: T | null;
  /**
   * When `data` is null: what could be normalized anyway, field by field. Not valid against the
   * schema (a required value is missing or unreadable), so the rules never run on it; it is kept
   * to show and score what was read.
   */
  partial?: unknown;
  /** Fields that were printed but could not be normalized, or required fields that are missing. */
  issues: string[];
}

const KG_PER_LB = '0.45359237';

const clean = (s: string | null | undefined): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

/**
 * How the issuing country prints numbers and dates, for the cases the text alone cannot settle:
 * "1.200" (one thousand two hundred in Germany, one point two in the US) and "03/04/2026" (3 April
 * in most countries, March 4 in the US). Set per document from the issuer's country by withLocale.
 */
export interface Locale {
  /** The country writes "1.234,56": a lone dot followed by groups of three digits groups thousands. */
  decimalComma: boolean;
  /** The country writes month/day/year. */
  monthFirst: boolean;
}

const DEFAULT_LOCALE: Locale = { decimalComma: false, monthFirst: false };
// Countries in the catalogs and common trade partners that write a decimal comma (heuristic: many
// exporters there print English formats too, which are unambiguous and parsed as before).
const DECIMAL_COMMA = new Set('DE FR IT ES PT NL BE AT DK SE NO FI PL CZ SK HU RO GR TR RU UA BR AR CL CO VN ID'.split(' '));
let locale = DEFAULT_LOCALE;

export function localeFor(country: string | null | undefined): Locale {
  const c = countryCode(country);
  return { decimalComma: !!c && DECIMAL_COMMA.has(c), monthFirst: c === 'US' };
}

/** Runs a (synchronous) normalization with the conventions of the issuing country. */
export function withLocale<T>(l: Locale, fn: () => T): T {
  const previous = locale;
  locale = l;
  try {
    return fn();
  } finally {
    locale = previous;
  }
}

/** "48,600.00" | "48600" | "USD 1,234.50" | "1.234,50" | "48 600,00" -> "48600.00" style decimal string. */
export function decimal(s: string | null | undefined): string | null {
  let t = clean(s);
  if (!t) return null;
  // Keep the first number only, so a unit after it ("320 M2", "1,140.00 KGS") never leaks digits in.
  const negative = /^[(-]/.test(t.replace(/^[A-Z$€£¥\s]+/i, ''));
  // A space (or no-break space) followed by exactly three digits groups thousands, as in "48 600,00".
  t = (t.match(/\d(?:[\d.,]|[ \u00a0\u202f](?=\d{3}(?!\d)))*/)?.[0] ?? '').replace(/[ \u00a0\u202f]/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European style, or a lone comma used as decimal mark ("12,5"). Three digits after a single
    // comma with no dot ("1,234") is a thousands separator.
    const after = t.length - lastComma - 1;
    if (lastDot === -1 && after === 3 && t.indexOf(',') === lastComma) t = t.replace(',', '');
    else t = t.replace(/\./g, '').replace(',', '.');
  } else if (locale.decimalComma && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.200" from a decimal-comma country: the dot groups thousands.
    t = t.replace(/\./g, '');
  } else {
    t = t.replace(/,/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  t = t.replace(/^0+(?=\d)/, '');
  return negative ? `-${t}` : t;
}

export function integer(s: string | null | undefined): number | null {
  const d = decimal(s);
  if (d === null || !/^\d+(\.0+)?$/.test(d)) return null;
  return Number(d.split('.')[0]);
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANV: 1, FEV: 2, FÉV: 2, AVR: 4, MAI: 5, JUIN: 6, JUIL: 7, AOU: 8, AOÛ: 8,
};

/** "2026-03-14" | "14-MAR-2026" | "Mar 14, 2026" | "14 March 2026" | "14/03/2026" | "14.03.2026" (day first; month first for US issuers) -> "2026-03-14". */
export function isoDate(s: string | null | undefined): string | null {
  const raw = clean(s)?.toUpperCase();
  if (!raw) return null;
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  // "14.03.2026": dots are the separators here, not abbreviation marks.
  const dotted = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotted) return iso(+dotted[3], +dotted[2], +dotted[1]);
  const t = raw.replace(/\./g, '');
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/ ]([A-ZÉÛ]{3,9})[-/ ,]+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 4)] ?? MONTHS[m[2].slice(0, 3)];
    return month ? iso(+m[3], month, +m[1]) : null;
  }
  m = t.match(/^([A-Z]{3,9}) (\d{1,2}),? (\d{4})$/);
  if (m) return MONTHS[m[1].slice(0, 3)] ? iso(+m[3], MONTHS[m[1].slice(0, 3)], +m[2]) : null;
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  // Day first unless the issuer writes month first (US) and the order is still possible.
  if (m) return locale.monthFirst && +m[1] <= 12 ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  return null;
}

const COUNTRY_NAMES: Record<string, string> = {
  CHINA: 'CN', "PEOPLE'S REPUBLIC OF CHINA": 'CN', PRC: 'CN', 'VIET NAM': 'VN', VIETNAM: 'VN', INDIA: 'IN',
  ITALY: 'IT', ITALIA: 'IT', GERMANY: 'DE', DEUTSCHLAND: 'DE', COLOMBIA: 'CO', CANADA: 'CA', 'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US', USA: 'US', 'U.S.A.': 'US', 'HONG KONG': 'HK', MEXICO: 'MX', JAPAN: 'JP',
  'SOUTH KOREA': 'KR', KOREA: 'KR', TAIWAN: 'TW', THAILAND: 'TH', 'UNITED KINGDOM': 'GB', UK: 'GB', FRANCE: 'FR', SPAIN: 'ES',
};

export function countryCode(s: string | null | undefined): string | null {
  const t = clean(s)?.toUpperCase();
  if (!t) return null;
  if (/^[A-Z]{2}$/.test(t)) return t;
  return COUNTRY_NAMES[t] ?? COUNTRY_NAMES[t.replace(/\./g, '')] ?? null;
}

export function currencyCode(s: string | null | undefined): string | null {
  const t = clean(s)?.toUpperCase();
  if (!t) return null;
  const symbols: Record<string, string> = { $: 'USD', 'US$': 'USD', 'C$': 'CAD', 'CA$': 'CAD', '€': 'EUR', 'RMB': 'CNY', '¥': 'CNY', '₹': 'INR' };
  if (symbols[t]) return symbols[t];
  const m = t.match(/\b([A-Z]{3})\b/);
  return m ? m[1] : null;
}

const UNIT_ALIASES: Record<string, string> = {
  PC: 'PCS', PCE: 'PCS', PIECE: 'PCS', PIECES: 'PCS', UNITS: 'PCS', UNIT: 'PCS', EA: 'PCS',
  PR: 'PRS', PAIR: 'PRS', PAIRS: 'PRS', SET: 'SETS', KGS: 'KG', KILOS: 'KG', 'M²': 'M2', SQM: 'M2', M2: 'M2',
};

export function quantityUnit(s: string | null | undefined): string | null {
  const t = clean(s)?.toUpperCase().replace(/\.$/, '');
  if (!t) return null;
  return UNIT_ALIASES[t] ?? t;
}

/** Weight with the printed value and unit kept; kg converted from pounds when needed. */
export function weight(w: RawWeight | null | undefined): Weight | null {
  if (!w) return null;
  let value = decimal(w.value);
  let unitText = clean(w.unit)?.toUpperCase() ?? '';
  // Models sometimes leave the unit inside the value ("1,140.00 KGS").
  if (!unitText && w.value) unitText = w.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (value === null) return null;
  if (/^(LB|LBS|POUNDS?)$/.test(unitText)) {
    return { kg: fromFixed(mul(value, KG_PER_LB)), raw: { value, unit: 'LB' } };
  }
  if (/^(KG|KGS|KILOS?|KILOGRAMS?|)$/.test(unitText)) {
    value = fromFixed(mul(value, '1'));
    return { kg: value, raw: { value, unit: 'KG' } };
  }
  if (/^(T|MT|TONS?|TONNES?)$/.test(unitText)) return { kg: fromFixed(mul(value, '1000')), raw: { value, unit: 'T' } };
  return null;
}

export function packageType(s: string | null | undefined): PackageGroup['type'] {
  const t = clean(s)?.toUpperCase() ?? '';
  if (/^(CTN|CTNS|CARTONS?|CARTON BOX(ES)?)$/.test(t)) return 'CTN';
  if (/^(PLT|PLTS|PALLETS?)$/.test(t)) return 'PLT';
  if (/^(BAG|BAGS|SACKS?)$/.test(t)) return 'BAG';
  if (/^(CRT|CRTS|CRATES?)$/.test(t)) return 'CRT';
  if (/^(DRM|DRMS|DRUMS?)$/.test(t)) return 'DRM';
  return 'OTHER';
}

export function transportMode(s: string | null | undefined): z.infer<typeof TransportMode> | null {
  const t = clean(s)?.toUpperCase() ?? '';
  if (/SEA|OCEAN|VESSEL|MARITIME/.test(t)) return 'SEA';
  if (/AIR/.test(t)) return 'AIR';
  if (/ROAD|TRUCK|LAND/.test(t)) return 'ROAD';
  return null;
}

/** Keeps a value only when it passes its schema; otherwise records an issue and drops it. */
function valid<S extends z.ZodType>(schema: S, value: unknown, field: string, issues: string[]): z.infer<S> | undefined {
  if (value === null || value === undefined) return undefined;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  issues.push(`${field}: could not normalize ${JSON.stringify(value)}`);
  return undefined;
}

/**
 * Canadian and US addresses identify their country by the postal code alone ("H7S 1P6", "TX 77041"),
 * which helps when the country line is missing or unreadable on a scan.
 */
export function countryFromPostalCode(postalCode: string | null | undefined, region?: string | null): string | null {
  const pc = clean(postalCode)?.toUpperCase();
  if (!pc) return null;
  if (/^[ABCEGHJ-NPRSTVXY]\d[A-Z] ?\d[A-Z]\d$/.test(pc)) return 'CA';
  if (/^\d{5}(-\d{4})?$/.test(pc) && /^[A-Z]{2}$/.test(clean(region)?.toUpperCase() ?? '')) return 'US';
  return null;
}

function rawAddress(p: RawParty): Address {
  const address: Address = {
    lines: p.addressLines.map((l) => clean(l)).filter((l): l is string => !!l),
    city: clean(p.city) ?? undefined,
    region: clean(p.region) ?? undefined,
    postalCode: clean(p.postalCode) ?? undefined,
    country: countryCode(p.country) ?? countryFromPostalCode(p.postalCode, p.region) ?? undefined,
  };
  address.lines = streetLines(address);
  return address;
}

function party(p: RawParty | null | undefined, field: string, issues: string[]): Party | undefined {
  if (!p || !clean(p.name)) return undefined;
  return valid(Party, { name: clean(p.name), address: rawAddress(p), taxId: clean(p.taxId) ?? undefined }, field, issues);
}

/** "Nhava Sheva, IN" -> name "Nhava Sheva", country IN, when the model leaves the country in the name. */
function place(p: RawPlace | null | undefined, field: string, issues: string[]): Location | undefined {
  let name = clean(p?.name);
  if (!p || !name) return undefined;
  let country = countryCode(p.country);
  const tail = name.match(/^(.*?),\s*([^,]+)$/);
  if (tail && countryCode(tail[2]) && (!country || countryCode(tail[2]) === country)) {
    name = tail[1];
    country = countryCode(tail[2]);
  }
  return valid(Location, { name, country: country ?? '' }, field, issues);
}

/** Drops an HS code or SKU the model copied into the description from the same cell. */
function description(text: string | null, hsCode: string | null, sku: string | null): string {
  let d = clean(text) ?? '';
  if (hsCode) d = d.replace(new RegExp(`\\s*(HS|HTS)?:?\\s*${hsCode.replace(/[.]/g, '\\.')}\\s*$`, 'i'), '');
  if (sku) d = d.replace(new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '');
  return d.trim();
}

function reference(v: string | null, field: string, issues: string[]): string | undefined {
  const t = clean(v);
  if (!t) return undefined;
  if (/\d/.test(t)) return t;
  issues.push(`${field}: "${t}" does not look like a document number`);
  return undefined;
}

const prune = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

function finish<S extends z.ZodType>(schema: S, value: unknown, issues: string[]): NormalizeResult<z.infer<S>> {
  const r = schema.safeParse(value);
  if (r.success) return { data: r.data, issues };
  return { data: null, partial: value, issues: [...issues, ...r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)] };
}

/** Issuer conventions from seller.country. */
export function normalizeInvoice(raw: RawInvoice): NormalizeResult<CommercialInvoice> {
  return withLocale(localeFor(raw.seller?.country), () => normalizeInvoiceAs(raw));
}

function normalizeInvoiceAs(raw: RawInvoice): NormalizeResult<CommercialInvoice> {
  const issues: string[] = [];
  const currency = currencyCode(raw.currency) ?? currencyCode(raw.invoiceTotalCurrency) ?? undefined;
  const money = (amount: string | null, cur: string | null, field: string) => {
    const a = decimal(amount);
    if (a === null) {
      if (clean(amount)) issues.push(`${field}: could not normalize ${JSON.stringify(amount)}`);
      return undefined;
    }
    return { amount: a, currency: currencyCode(cur) ?? currency ?? '' };
  };

  const lines: InvoiceLine[] = raw.lines.map((l, i) =>
    prune({
      lineNo: integer(l.lineNo) ?? i + 1,
      sku: clean(l.sku) ?? undefined,
      description: description(l.description, clean(l.hsCode), clean(l.sku)),
      quantity: { value: decimal(l.quantity) ?? '', unit: quantityUnit(l.unit) ?? 'PCS' },
      unitPrice: money(l.unitPrice, l.unitPriceCurrency, `lines[${i}].unitPrice`),
      lineTotal: money(l.lineTotal, l.lineTotalCurrency, `lines[${i}].lineTotal`),
      countryOfOrigin: countryCode(l.countryOfOrigin) ?? countryCode(raw.countryOfOrigin) ?? undefined,
      hsCode: valid(CommercialInvoice.shape.lines.element.shape.hsCode, clean(l.hsCode), `lines[${i}].hsCode`, issues),
    }) as InvoiceLine,
  );

  const charges: Record<string, unknown> = {};
  for (const c of raw.charges) {
    if (c.type === 'other') continue;
    const m = money(c.amount, c.currency, `charges.${c.type}`);
    if (m) charges[c.type] = m;
  }

  const incotermCode = clean(raw.incotermCode)?.toUpperCase().match(/^[A-Z]{3}/)?.[0];
  const incoterm = incotermCode && Incoterm.safeParse(incotermCode).success
    ? { code: incotermCode, place: clean(raw.incotermPlace) ?? '' }
    : undefined;
  const mode = transportMode(raw.transportMode);

  return finish(
    CommercialInvoice,
    prune({
      invoiceNumber: clean(raw.invoiceNumber) ?? '',
      invoiceDate: isoDate(raw.invoiceDate) ?? undefined,
      poNumber: clean(raw.poNumber) ?? undefined,
      seller: party(raw.seller, 'seller', issues),
      buyer: party(raw.buyer, 'buyer', issues),
      consignee: party(raw.consignee, 'consignee', issues),
      shipmentDate: isoDate(raw.shipmentDate) ?? undefined,
      portOfEntry: place(raw.portOfEntry, 'portOfEntry', issues),
      transport: mode ? prune({ mode, placeOfShipment: place(raw.placeOfShipment, 'transport.placeOfShipment', issues) }) : undefined,
      incoterm,
      paymentTerms: clean(raw.paymentTerms) ?? undefined,
      currency,
      packageCount: integer(raw.totalPackages) ?? undefined,
      lines,
      grossWeight: weight(raw.grossWeight) ?? undefined,
      netWeight: weight(raw.netWeight) ?? undefined,
      invoiceTotal: money(raw.invoiceTotal, raw.invoiceTotalCurrency, 'invoiceTotal'),
      charges: Object.keys(charges).length ? charges : undefined,
    }),
    issues,
  );
}

/** Issuer conventions from seller.country. */
export function normalizePackingList(raw: RawPackingList): NormalizeResult<PackingList> {
  return withLocale(localeFor(raw.seller?.country), () => normalizePackingListAs(raw));
}

function normalizePackingListAs(raw: RawPackingList): NormalizeResult<PackingList> {
  const issues: string[] = [];
  const packages = raw.packages.map((g) => {
    const dims = clean(g.dimensionsCm)?.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    return prune({
      range: clean(g.range) ?? '',
      count: integer(g.count) ?? 0,
      type: packageType(g.packageType),
      marks: clean(raw.marks) ?? undefined,
      contents: [prune({ sku: clean(g.sku) ?? undefined, description: clean(g.description) ?? '', quantity: { value: decimal(g.quantity) ?? '', unit: quantityUnit(g.unit) ?? 'PCS' } })],
      netWeight: weight(g.netWeight) ?? undefined,
      grossWeight: weight(g.grossWeight) ?? undefined,
      dimensionsCm: dims ? [Number(dims[1]), Number(dims[2]), Number(dims[3])] : undefined,
    });
  });
  return finish(
    PackingList,
    prune({
      packingListNumber: clean(raw.packingListNumber) ?? undefined,
      // A document number has digits; OCR debris like "rr,," is treated as unreadable, not compared.
      invoiceRef: reference(raw.invoiceRef, 'invoiceRef', issues),
      seller: party(raw.seller, 'seller', issues),
      consignee: party(raw.consignee, 'consignee', issues),
      packages,
      totals: prune({
        packageCount: integer(raw.totalPackages) ?? packages.reduce((acc, p) => acc + (p.count ?? 0), 0),
        netWeight: weight(raw.totalNetWeight) ?? undefined,
        grossWeight: weight(raw.totalGrossWeight) ?? undefined,
        volumeM3: decimal(raw.totalVolumeM3) ?? undefined,
      }),
    }),
    issues,
  );
}

/** Issuer conventions from portOfLoading.country (the BL is issued where the cargo is loaded). */
export function normalizeBillOfLading(raw: RawBillOfLading): NormalizeResult<BillOfLading> {
  return withLocale(localeFor(raw.portOfLoading?.country ?? raw.shipper?.country), () => normalizeBillOfLadingAs(raw));
}

function normalizeBillOfLadingAs(raw: RawBillOfLading): NormalizeResult<BillOfLading> {
  const issues: string[] = [];
  const title = clean(raw.documentTitle)?.toUpperCase() ?? '';
  const issuer = clean(raw.issuer)?.toUpperCase() ?? '';
  const containers = raw.containers
    .map((c, i) =>
      valid(
        Container,
        prune({
          number: clean(c.number)?.toUpperCase().replace(/[\s-]/g, ''),
          seal: clean(c.seal) ?? undefined,
          type: clean(c.type) ?? undefined,
          packages: integer(c.packages) ?? undefined,
          grossWeight: weight(c.grossWeight) ?? undefined,
          volumeM3: decimal(c.volumeM3) ?? undefined,
        }),
        `containers[${i}]`,
        issues,
      ),
    )
    .filter((c): c is Container => !!c);
  const freight = clean(raw.freightTerms)?.toUpperCase();
  return finish(
    BillOfLading,
    prune({
      blNumber: clean(raw.blNumber) ?? '',
      blType: /HOUSE|MASTER/.test(issuer) ? { issuer: issuer.includes('HOUSE') ? 'HBL' : 'MBL', form: /WAYBILL/.test(title) ? 'SEAWAY' : 'ORIGINAL' } : undefined,
      bookingNumber: clean(raw.bookingNumber) ?? undefined,
      carrier: clean(raw.carrierName) ? prune({ name: clean(raw.carrierName), scac: clean(raw.scac) ?? undefined }) : undefined,
      shipper: party(raw.shipper, 'shipper', issues),
      consignee: party(raw.consignee, 'consignee', issues),
      notifyParty: party(raw.notifyParty, 'notifyParty', issues),
      vessel: clean(raw.vessel) ?? undefined,
      voyage: clean(raw.voyage) ?? undefined,
      placeOfReceipt: place(raw.placeOfReceipt, 'placeOfReceipt', issues),
      portOfLoading: place(raw.portOfLoading, 'portOfLoading', issues),
      portOfDischarge: place(raw.portOfDischarge, 'portOfDischarge', issues),
      placeOfDelivery: place(raw.placeOfDelivery, 'placeOfDelivery', issues),
      containers,
      totalPackages: integer(raw.totalPackages) ?? undefined,
      totalGrossWeight: weight(raw.totalGrossWeight) ?? undefined,
      marksAndNumbers: clean(raw.marksAndNumbers) ?? undefined,
      cargoDescription: clean(raw.cargoDescription) ?? '',
      freightTerms: freight?.includes('PREPAID') ? 'PREPAID' : freight?.includes('COLLECT') ? 'COLLECT' : undefined,
      placeOfIssue: clean(raw.placeOfIssue) ?? undefined,
      dateOfIssue: isoDate(raw.dateOfIssue) ?? undefined,
      shippedOnBoardDate: isoDate(raw.shippedOnBoardDate) ?? undefined,
      references: raw.references.length ? raw.references : undefined,
    }),
    issues,
  );
}

/** "8481.80" | "HTS 8481.80.1020" | "848180" -> digits only ("848180"); null when fewer than 6 digits. */
export function htsCode(s: string | null | undefined): string | null {
  const digits = clean(s)?.replace(/^(HTSUS|HTS|HS)\b\W*/i, '').replace(/\D/g, '');
  return digits && digits.length >= 6 ? digits : null;
}

/** Importer of record / consignee number: "36-412876500" kept as printed, spaces dropped, uppercased. */
function filerNumber(s: string | null | undefined, field: string, issues: string[]): string | undefined {
  const t = clean(s)?.toUpperCase().replace(/\s+/g, '');
  if (!t) return undefined;
  if (/\d{6}/.test(t.replace(/\D/g, ''))) return t;
  issues.push(`${field}: "${t}" does not look like an importer number`);
  return undefined;
}

export function normalizeIsf(raw: RawIsf): NormalizeResult<Isf> {
  const issues: string[] = [];
  const hts = htsCode(raw.htsCode);
  if (clean(raw.htsCode) && !hts) issues.push(`htsCode: could not normalize ${JSON.stringify(raw.htsCode)}`);
  const origin = countryCode(raw.countryOfOrigin);
  if (clean(raw.countryOfOrigin) && !origin) issues.push(`countryOfOrigin: could not normalize ${JSON.stringify(raw.countryOfOrigin)}`);
  const stuffing = raw.containerStuffingLocation ? rawAddress(raw.containerStuffingLocation) : undefined;
  return finish(
    Isf,
    prune({
      seller: party(raw.seller, 'seller', issues),
      buyer: party(raw.buyer, 'buyer', issues),
      importerOfRecordNumber: filerNumber(raw.importerOfRecordNumber, 'importerOfRecordNumber', issues),
      consigneeNumber: filerNumber(raw.consigneeNumber, 'consigneeNumber', issues),
      manufacturer: party(raw.manufacturer, 'manufacturer', issues),
      shipToParty: party(raw.shipToParty, 'shipToParty', issues),
      countryOfOrigin: origin ?? undefined,
      htsCode: hts ?? undefined,
      containerStuffingLocation: stuffing ? valid(Address, stuffing, 'containerStuffingLocation', issues) : undefined,
      consolidator: party(raw.consolidator, 'consolidator', issues),
    }),
    issues,
  );
}
