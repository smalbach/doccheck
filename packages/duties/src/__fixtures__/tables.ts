import type { CommercialInvoice } from '@doccheck/schemas';
import { dec, fmt, sum } from '../decimal';
import type { DutyTables } from '../tables';
import type { DutyContext } from '../types';

const meta = (table: string) => ({ table, source: `test ${table}`, version: 'test', dataDate: '2026-10-16', validThrough: '2026-12-31' });
const EU = ['DE', 'IT', 'FR'];

/** Small tables with known rates, so every worked example in the tests can be checked by hand. */
export function testTables(): DutyTables {
  return {
    usHts: {
      meta: { ...meta('us-hts'), revision: 'test-rev' },
      rows: [
        ['8482', 0, 'Ball or roller bearings:', '', '', '', ''],
        ['8482.10', 1, 'Ball bearings:', '', '', '', ''],
        ['8482.10.10', 2, 'With integral shafts', '', '2.4%', 'Free (A+,AU,S,SG)', '35%'],
        ['8482.10.10.00', 3, 'With integral shafts', 'No.', '', '', ''],
        ['8482.10.50', 2, 'Other', '', '9%', 'Free (A+,AU,CO,S,SG)', '67%'],
        ['8482.10.50.04', 3, 'Unground', 'No.', '', '', ''],
        ['8482.10.50.08', 3, 'Thrust bearings', 'No.,kg', '', '', ''],
        ['6109', 0, 'T-shirts:', '', '', '', ''],
        ['6109.10.00', 1, 'Of cotton', '', '16.5%', 'Free (AU,CO,S)', '90%'],
        ['6109.10.00.04', 2, "Men's", 'doz.,kg', '', '', ''],
        ['8481', 0, 'Taps and valves:', '', '', '', ''],
        ['8481.80.90', 1, 'Other valves', '', '2%', 'Free (A,S)', '35%'],
        ['8481.80.90.50', 2, 'Other', 'No.', '', '', ''],
        ['8481.80.30', 1, 'Hand operated, of iron or steel', '', '12%', 'Free (S)', '45%'],
        ['8481.80.30.00', 2, 'Hand operated, of iron or steel', 'No.', '', '', ''],
        ['1509', 0, 'Olive oil:', '', '', '', ''],
        ['1509.20.20', 1, 'Extra virgin, in containers under 18 kg', '', '5¢/kg on contents and container', 'Free (A,S)', '17.6¢/kg'],
        ['1509.20.20.00', 2, 'Extra virgin, in containers under 18 kg', 'kg', '', '', ''],
        ['6907', 0, 'Ceramic tiles:', '', '', '', ''],
        ['6907.21.90', 1, 'Other', '', '8.5%', 'Free (S)', '55%'],
        ['6907.21.90.00', 2, 'Other', 'm2', '', '', ''],
      ],
    },
    caTariff: {
      meta: { ...meta('ca-tariff'), revision: 'test-ca' },
      rows: [
        ['6109.10', 'Of cotton', '', '', {}],
        ['6109.10.00', 'Of cotton', '', '2026-01-01', { MFN: '18 %', UST: 'Free', MXT: 'Free', CEUT: 'Free', CPTPT: 'Free' }],
        ['6109.10.00.11', 'T-shirts, white', 'NMB', '', {}],
        ['8509.40', 'Food grinders and mixers', '', '', {}],
        ['8509.40.10', 'Grape crushers', '', '', { MFN: '8 %', UST: 'Free', CEUT: 'Free' }],
        ['8509.40.10.00', 'Grape crushers', 'NMB', '', {}],
        ['8509.40.90', 'Other', '', '', { MFN: 'Free', UST: 'Free', CEUT: 'Free' }],
        ['8509.40.90.20', 'Food mixers', 'NMB', '', {}],
        ['8509.40.90.90', 'Other', 'NMB', '', {}],
        ['2204.21.21', 'Wine, not over 14.9 % vol', '', '', { MFN: '4.68 ¢/litre', UST: 'Free', CEUT: 'Free' }],
        ['2204.21.21.00', 'Wine, not over 14.9 % vol', 'LTR', '', {}],
        ['7318.15.00', 'Other screws and bolts', '', '', { MFN: 'Free', UST: 'Free' }],
        ['7318.15.00.10', 'Screws', 'KGM', '', {}],
      ],
    },
    fxCa: {
      meta: meta('fx-ca'),
      rows: [
        ['2026-03-20', { USD: '1.4000', EUR: '1.5000' }],
        ['2026-03-23', { USD: '1.4100', EUR: '1.5100' }],
      ],
    },
    fxUs: {
      meta: meta('fx-us'),
      rows: [
        ['2026-03-20', { EUR: { usdPerUnit: '1.0800' }, CNY: { unitsPerUsd: '7.1000' } }],
        ['2026-03-23', { EUR: { usdPerUnit: '1.0900' }, CNY: { unitsPerUsd: '7.2000' } }],
      ],
    },
    usAdditional: {
      meta: meta('us-additional'),
      originsReviewed: ['CN', 'DE', 'IT', 'FR', 'CA', 'MX'],
      entries: [
        { id: '301-CN-LIST1', program: 'Section 301 List 1', heading: '9903.88.01', description: '', origins: ['CN'], hs: ['8482.10'], kind: 'adValorem', percent: '25', group: '301-china', effectiveFrom: '2018-07-06', effectiveTo: null, source: 'test', verified: true },
        { id: '232-STEEL', program: 'Section 232 steel', description: '', origins: ['*'], hs: ['8481.80.30'], kind: 'adValorem', percent: '50', basis: 'metalContent', group: '232', effectiveFrom: '2025-06-04', effectiveTo: null, source: 'test', verified: true },
        { id: '301-FL-CN', program: 'Section 301 forced labor', heading: '9903.05.31', description: '', origins: ['CN'], hs: ['*'], kind: 'adValorem', percent: '12.5', group: '301-fl', notWith: ['232'], effectiveFrom: '2026-07-24', effectiveTo: null, source: 'test', verified: false },
        { id: '301-FL-EU', program: 'Section 301 forced labor (EU)', heading: '9903.05.39', description: '', origins: EU, hs: ['*'], kind: 'topUpTo', percent: '10', group: '301-fl', notWith: ['232'], effectiveFrom: '2026-07-24', effectiveTo: null, source: 'test', verified: true },
        { id: '301-FL-CA', program: 'Section 301 forced labor (Canada)', description: '', origins: ['CA'], hs: ['*'], kind: 'adValorem', percent: '10', group: '301-fl', notWith: ['232'], exemptUnderPrograms: ['S'], effectiveFrom: '2026-07-24', effectiveTo: null, source: 'test', verified: true },
        { id: '122-GLOBAL', program: 'Section 122', description: '', origins: ['*'], hs: ['*'], kind: 'adValorem', percent: '10', group: '122', notWith: ['232'], exemptUnderPrograms: ['S'], effectiveFrom: '2026-02-24', effectiveTo: '2026-07-23', source: 'test', verified: true },
      ],
    },
    caAdditional: { meta: meta('ca-surtaxes'), originsReviewed: [], entries: [] },
    usFees: {
      meta: meta('us-fees'),
      mpf: [
        { from: '2025-10-01', to: '2026-09-30', percent: '0.3464', minimum: '33.58', maximum: '651.50', source: 'FY2026' },
        { from: '2026-10-01', to: '2027-09-30', percent: '0.3464', minimum: '34.58', maximum: '670.86', source: 'FY2027' },
      ],
      hmf: [{ from: '1987-04-01', to: null, percent: '0.125', modes: ['SEA'], source: 'HMF' }],
      informalEntryLimit: '2500',
    },
    caTaxes: {
      meta: meta('ca-taxes'),
      gst: { percent: '5', from: '2008-01-01', source: 'ETA' },
      provinces: [
        { province: 'ON', name: 'Ontario', hst: '13', from: '2010-07-01' },
        { province: 'NS', name: 'Nova Scotia', hst: '15', from: '2010-07-01', to: '2025-03-31' },
        { province: 'NS', name: 'Nova Scotia', hst: '14', from: '2025-04-01' },
        { province: 'QC', name: 'Quebec', pst: { name: 'QST', percent: '9.975' }, from: '2013-01-01' },
        { province: 'AB', name: 'Alberta', from: '2008-01-01' },
      ],
      exciseChapters: [{ chapter: '22', note: 'Wine: excise duty may apply.' }],
    },
    adcvd: {
      meta: meta('adcvd'),
      cases: [{ id: 'US-A-570-108', destination: 'US', caseNumber: 'A-570-108', product: 'Ceramic tile', kind: 'AD', origins: ['CN'], hs: ['6907'], since: '2020-06-01', until: null, verified: true }],
    },
    fta: {
      meta: meta('fta'),
      agreements: [
        { id: 'CUSMA', name: 'CUSMA', CA: { treatments: { US: 'UST', MX: 'MXT' } }, US: { program: 'S', origins: ['CA', 'MX'] }, certification: 'cusma', proof: 'Certification of origin' },
        { id: 'CETA', name: 'CETA', CA: { treatments: { DE: 'CEUT', IT: 'CEUT', FR: 'CEUT' } }, certification: 'origin-statement', proof: 'Origin declaration' },
        { id: 'US-CO-TPA', name: 'US-Colombia TPA', US: { program: 'CO', origins: ['CO'] }, certification: 'certificate', proof: 'Certification' },
      ],
      caTreatments: { MFN: { name: 'Most-Favoured-Nation Tariff', code: '2' }, UST: { name: 'United States Tariff', code: '10' }, MXT: { name: 'Mexico Tariff', code: '11' }, CEUT: { name: 'Canada-European Union Tariff' } },
      cusmaHints: [{ chapters: ['50', '63'], hint: 'Yarn forward.' }],
      cusmaDefaultHint: 'Check Annex 4-B.',
    },
  };
}

const party = (name: string, country: string, extra: { lines?: string[]; city?: string; region?: string } = {}) => ({
  name,
  address: { lines: extra.lines ?? ['1 Main St'], city: extra.city ?? 'City', ...(extra.region ? { region: extra.region } : {}), country },
});

/** An invoice with the given lines; everything else is a plain FOB sale in USD. */
export function invoice(over: Partial<CommercialInvoice> & { lines: CommercialInvoice['lines'] }): CommercialInvoice {
  const total = fmt(sum(over.lines.map((l) => dec(l.lineTotal.amount))));
  return {
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-03-18',
    shipmentDate: '2026-03-20',
    seller: party('Rodex Leather Co., Ltd.', 'VN', { lines: ['1234 Industrial Road'], city: 'Ho Chi Minh City' }),
    buyer: party('Buyer Inc.', 'US', { region: 'NJ' }),
    currency: 'USD',
    incoterm: { code: 'FOB', place: 'Shanghai' },
    invoiceTotal: { amount: total, currency: over.currency ?? 'USD' },
    ...over,
  };
}

export function line(lineNo: number, hsCode: string | undefined, origin: string | undefined, amount: string, currency = 'USD', qty = { value: '100', unit: 'PCS' }, sku?: string): CommercialInvoice['lines'][number] {
  return {
    lineNo,
    ...(sku ? { sku } : {}),
    description: `Goods ${lineNo}`,
    quantity: qty,
    unitPrice: { amount: '1.00', currency },
    lineTotal: { amount, currency },
    ...(origin ? { countryOfOrigin: origin } : {}),
    ...(hsCode ? { hsCode } : {}),
  };
}

export function ctx(destination: 'CA' | 'US', inv: CommercialInvoice, extra: Partial<DutyContext> = {}): DutyContext {
  return { shipmentId: 'S1', destination, invoice: { id: 'inv-1', data: inv }, transportMode: 'SEA', ...extra };
}
