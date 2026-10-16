import { awbCheckDigit, fromFixed, mul, toFixed } from '@doccheck/rules';
import type {
  AirWaybill, ArrivalNotice, Attestation, CertificateOfOrigin, CusmaCertification, DangerousGoodsDeclaration, Party, WoodPackagingCertificate,
} from '@doccheck/schemas';
import type { ShipmentContext } from '@doccheck/rules';
import type { DatasetEntry } from './dataset';
import type { ErrorLabel } from './errors';
import { weight, type ShipmentDocuments, type SyntheticShipment } from './generate';
import { Rng } from './rng';

/**
 * Set v1-docs: v1 shipments (their clean versions) with the other documents a shipment carries: an
 * air waybill instead of the bill of lading for air freight, a chamber certificate of origin or a
 * CUSMA certification, an arrival notice, an ISPM 15 heat-treatment certificate when the goods ride on
 * wooden pallets or crates, and a dangerous goods declaration when a line contains lithium batteries.
 * About three in four carry one or two injected errors, each labelled with the T rule that must flag
 * it. buildDataset() is not touched: v1 and its PDFs stay exactly as they are.
 */

export type DocsDocumentKey = 'airWaybill' | 'certificateOfOrigin' | 'cusmaCertification' | 'arrivalNotice' | 'woodPackaging' | 'dangerousGoods';

export type DocsErrorKind =
  | 'awb_check_digit'
  | 'awb_pieces_mismatch'
  | 'awb_weight_mismatch'
  | 'coo_exporter_mismatch'
  | 'coo_hs_mismatch'
  | 'cusma_missing_element'
  | 'dg_declaration_missing'
  | 'ispm15_missing'
  | 'arrival_notice_mismatch'
  | 'coo_unsigned';

export type DocsLabel = Omit<ErrorLabel, 'kind' | 'document'> & { kind: DocsErrorKind; document: DocsDocumentKey | 'invoice' | 'billOfLading' | 'packingList' };

export interface DocsDocuments extends Omit<ShipmentDocuments, 'billOfLading'> {
  billOfLading?: ShipmentDocuments['billOfLading'];
  airWaybill?: AirWaybill;
  certificateOfOrigin?: CertificateOfOrigin;
  cusmaCertification?: CusmaCertification;
  arrivalNotice?: ArrivalNotice;
  woodPackaging?: WoodPackagingCertificate;
  dangerousGoods?: DangerousGoodsDeclaration;
}

export interface DocsShipment extends Omit<SyntheticShipment, 'documents'> {
  documents: DocsDocuments;
  /** What the paper shows: whether each certificate is signed and stamped (rule T13 reads it from the PDF). */
  attestations: Partial<Record<DocsDocumentKey, Attestation>>;
  mode: 'SEA' | 'AIR';
}

export interface DocsEntry {
  shipment: DocsShipment;
  labels: DocsLabel[];
}

export const DOCS_ERROR_KINDS: DocsErrorKind[] = [
  'awb_check_digit', 'awb_pieces_mismatch', 'awb_weight_mismatch', 'coo_exporter_mismatch', 'coo_hs_mismatch', 'cusma_missing_element',
  'dg_declaration_missing', 'ispm15_missing', 'arrival_notice_mismatch', 'coo_unsigned',
];

const AIRLINES = [
  { name: 'Pacific Crest Air Cargo', prefix: '176', code: 'PC' },
  { name: 'Meridian Airfreight', prefix: '160', code: 'MF' },
  { name: 'Aurora Cargo Airlines', prefix: '618', code: 'AU' },
];
const AIRPORTS: Record<string, [string, string][]> = {
  CN: [['Shanghai Pudong', 'PVG'], ['Shenzhen Bao’an', 'SZX'], ['Guangzhou Baiyun', 'CAN']],
  VN: [['Tan Son Nhat', 'SGN']], IN: [['Mumbai', 'BOM']], CO: [['Bogota El Dorado', 'BOG']], IT: [['Milan Malpensa', 'MXP']], DE: [['Frankfurt', 'FRA']],
  MX: [['Mexico City', 'MEX'], ['Monterrey', 'MTY']],
  CA: [['Toronto Pearson', 'YYZ'], ['Vancouver', 'YVR'], ['Montreal Trudeau', 'YUL']],
  US: [['Los Angeles', 'LAX'], ['Chicago O’Hare', 'ORD'], ['New York JFK', 'JFK']],
};
const CHAMBERS: Record<string, string> = {
  CN: 'China Council for the Promotion of International Trade', VN: 'Vietnam Chamber of Commerce and Industry', IN: 'Federation of Indian Export Organisations',
  CO: 'Cámara de Comercio de Bogotá', IT: 'Camera di Commercio di Milano', DE: 'Industrie- und Handelskammer Hamburg',
};
/** A fictional Mexican producer: CUSMA shipments are its goods, flown from Mexico. */
const NORTE: Party = { name: 'Norte Manufacturas S.A. de C.V.', address: { lines: ['Av. Industrial 2450'], city: 'Monterrey', region: 'NL', postalCode: '64000', country: 'MX' }, taxId: 'NMA981204KL3' };
const OTHER_EXPORTER: Party = { name: 'Golden Bridge Trading Co., Ltd.', address: { lines: ['55 Harbour Rd'], city: 'Hong Kong', country: 'HK' } };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function awbFor(prefix: string, serial: number): string {
  const s = String(serial).padStart(7, '0');
  return `${prefix}-${s}${awbCheckDigit(s)}`;
}

const hsHeading = (hs: string | undefined) => hs?.replace(/\D/g, '').slice(0, 6);
const hsDotted = (digits: string) => `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;

/** The other documents for one clean shipment. */
function withDocuments(clean: SyntheticShipment, rng: Rng): DocsShipment {
  const s = structuredClone(clean) as unknown as DocsShipment;
  const docs = s.documents;
  const inv = docs.invoice;
  const bl = docs.billOfLading!;
  const cusma = rng.chance(0.2);
  s.mode = cusma || rng.chance(0.35) ? 'AIR' : 'SEA';
  s.attestations = {};

  if (cusma) {
    // The goods are made in Mexico by Norte and flown to the buyer.
    inv.seller = NORTE;
    inv.exporter = NORTE;
    inv.lines.forEach((l) => (l.countryOfOrigin = 'MX'));
    docs.packingList.seller = NORTE;
    bl.shipper = NORTE;
    if (docs.isf) Object.assign(docs.isf, { seller: NORTE, manufacturer: NORTE, countryOfOrigin: 'MX', containerStuffingLocation: NORTE.address });
  }

  const packageTypes = new Set(docs.packingList.packages.map((p) => p.type));
  const wood = packageTypes.has('PLT') ? 'WOODEN PALLETS' : packageTypes.has('CRT') ? 'WOODEN CRATES' : undefined;
  const dg = rng.chance(0.2);
  if (dg) inv.lines[0].description = `${inv.lines[0].description}, with lithium-ion battery UN3481`;

  const goods = bl.cargoDescription.replace(/^SAID TO CONTAIN \d+ \w+ /, '');
  if (s.mode === 'AIR') {
    const airline = rng.pick(AIRLINES);
    const origin = cusma ? 'MX' : inv.seller.address.country!;
    const [depName, dep] = rng.pick(AIRPORTS[origin] ?? AIRPORTS.CN);
    const [destName, dest] = rng.pick(AIRPORTS[s.destination]);
    const flightDate = addDays(inv.shipmentDate!, rng.int(0, 2));
    const volume = docs.packingList.totals.volumeM3 ?? '1';
    const volumetric = fromFixed(mul(volume, '167'));
    const gross = docs.packingList.totals.grossWeight!.kg;
    const house = rng.chance(0.4);
    const master = awbFor(airline.prefix, rng.int(1_000_000, 9_999_999));
    inv.transport = { mode: 'AIR' };
    docs.airWaybill = {
      awbNumber: house ? `${bl.blNumber.slice(0, 4)}${rng.int(100000, 999999)}` : master,
      issuer: house ? 'HAWB' : 'MAWB',
      ...(house ? { masterAwbNumber: master } : {}),
      carrier: { name: airline.name, ...(house ? {} : { iataPrefix: airline.prefix }) },
      shipper: inv.seller,
      consignee: bl.consignee,
      notifyParty: bl.notifyParty,
      airportOfDeparture: { name: depName, iata: dep },
      airportOfDestination: { name: destName, iata: dest },
      flights: [{ flight: `${airline.code}${rng.int(100, 999)}`, date: flightDate }],
      pieces: docs.packingList.totals.packageCount,
      grossWeight: weight(gross),
      chargeableWeight: weight(toFixed(volumetric) > toFixed(gross) ? volumetric : gross),
      volumeM3: volume,
      natureOfGoods: `${wood ? `${wood} ` : ''}${goods}`,
      freightTerms: bl.freightTerms,
      references: [inv.invoiceNumber],
      placeOfExecution: depName,
      executedOn: inv.shipmentDate,
    };
    delete docs.billOfLading;
    delete docs.isf; // the ISF is for ocean freight only
  } else if (wood) {
    bl.cargoDescription = bl.cargoDescription.replace(/^SAID TO CONTAIN (\d+) \w+ /, `SAID TO CONTAIN $1 ${wood} `);
  }

  const goodsList = inv.lines.map((l) => ({ description: l.description.replace(/, with lithium-ion battery UN3481$/, ''), hsCode: l.hsCode }));
  if (cusma) {
    docs.cusmaCertification = {
      certifierRole: 'EXPORTER',
      certifier: NORTE,
      exporter: NORTE,
      producer: NORTE,
      importer: inv.buyer,
      goods: goodsList.map((g) => ({ ...g, originCriterion: rng.pick(['A', 'B', 'B', 'C'] as const), countryOfOrigin: 'MX' })),
      ...(rng.chance(0.3) ? { blanketPeriod: { from: '2026-01-01', to: '2026-12-31' } } : {}),
      signature: { name: 'Ana Ruiz Treviño', title: 'Export Manager', date: addDays(inv.invoiceDate!, 1) },
      invoiceRefs: [inv.invoiceNumber],
    };
    s.attestations.cusmaCertification = { signature: true, stamp: false };
  } else if (rng.chance(0.6)) {
    const country = inv.seller.address.country!;
    docs.certificateOfOrigin = {
      certificateNumber: `CO-${country}-${rng.int(100000, 999999)}`,
      issuer: CHAMBERS[country] ?? 'Chamber of Commerce',
      exporter: inv.seller,
      consignee: inv.consignee ?? inv.buyer,
      countryOfOrigin: country,
      transport: s.mode === 'AIR' ? 'By air' : `By sea from ${bl.portOfLoading.name} to ${bl.portOfDischarge.name}`,
      goods: goodsList.map((g, i) => ({ itemNo: i + 1, ...g })),
      invoiceRefs: [inv.invoiceNumber],
      placeOfIssue: inv.seller.address.city,
      dateOfIssue: addDays(inv.invoiceDate!, 1),
    };
    s.attestations.certificateOfOrigin = { signature: true, stamp: true };
  }

  if (rng.chance(0.5)) {
    const awb = docs.airWaybill;
    docs.arrivalNotice = {
      noticeNumber: `AN-${rng.int(10000, 99999)}`,
      carrier: awb ? { name: awb.carrier!.name } : bl.carrier,
      mode: s.mode,
      transportDocumentNumber: awb ? awb.awbNumber : bl.blNumber,
      ...(awb ? { flight: awb.flights![0].flight } : { vessel: bl.vessel, voyage: bl.voyage, portOfLoading: bl.portOfLoading, portOfDischarge: bl.portOfDischarge }),
      estimatedArrival: addDays((awb?.flights?.[0].date ?? bl.shippedOnBoardDate)!, awb ? 1 : rng.int(14, 24)),
      consignee: awb?.consignee ?? bl.consignee,
      ...(awb ? {} : { containers: bl.containers.map((c) => ({ number: c.number, seal: c.seal, type: c.type })) }),
      packages: awb?.pieces ?? bl.totalPackages,
      grossWeight: awb?.grossWeight ?? bl.totalGrossWeight,
      cargoDescription: awb?.natureOfGoods ?? bl.cargoDescription,
      freightTerms: awb?.freightTerms ?? bl.freightTerms,
      lastFreeDay: addDays((awb?.flights?.[0].date ?? bl.shippedOnBoardDate)!, awb ? 4 : rng.int(19, 29)),
    };
  }

  if (wood) {
    docs.woodPackaging = {
      certificateNumber: `HT-${rng.int(10000, 99999)}`,
      kind: 'HEAT_TREATMENT',
      treatment: 'HT',
      ispmMark: { country: cusma ? 'MX' : inv.seller.address.country!, registration: String(rng.int(1000, 9999)), treatment: 'HT' },
      treatmentDate: addDays(inv.invoiceDate!, -rng.int(3, 15)),
      issuer: 'Accredited treatment provider',
      exporter: inv.seller,
      packagingDescription: wood.toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      invoiceRef: inv.invoiceNumber,
    };
  }

  if (dg) {
    docs.dangerousGoods = {
      shipper: inv.seller,
      consignee: inv.consignee ?? inv.buyer,
      transportDocumentNumber: docs.airWaybill?.awbNumber ?? bl.blNumber,
      mode: s.mode,
      regulation: s.mode === 'AIR' ? 'IATA' : 'IMDG',
      items: [{ unNumber: 'UN3481', properShippingName: 'LITHIUM ION BATTERIES CONTAINED IN EQUIPMENT', hazardClass: '9', packingGroup: 'II', quantity: inv.lines[0].quantity }],
      emergencyContact: '+1 613 996 6666',
      signatory: { name: 'Li Wei', place: inv.seller.address.city, date: addDays(inv.invoiceDate!, 1) },
    };
  }
  return s;
}

/** The arrival notice was issued from the waybill as it was booked, so a changed waybill also disagrees with it (T12). */
const withNotice = (s: DocsShipment, rule: string) => (s.documents.arrivalNotice ? [rule, 'T12'] : [rule]);

interface Injector {
  kind: DocsErrorKind;
  applies(s: DocsShipment): boolean;
  apply(s: DocsShipment, rng: Rng): DocsLabel;
}

const INJECTORS: Injector[] = [
  {
    kind: 'awb_check_digit',
    applies: (s) => s.documents.airWaybill?.issuer === 'MAWB',
    apply(s) {
      const awb = s.documents.airWaybill!;
      const before = awb.awbNumber;
      awb.awbNumber = `${before.slice(0, -1)}${(Number(before.slice(-1)) + 1) % 7}`;
      return { kind: this.kind, document: 'airWaybill', field: 'awbNumber', before, after: awb.awbNumber, expectedRuleIds: withNotice(s, 'T1'), description: `Air waybill number ${awb.awbNumber} has a wrong check digit.` };
    },
  },
  {
    kind: 'awb_pieces_mismatch',
    applies: (s) => !!s.documents.airWaybill,
    apply(s, rng) {
      const awb = s.documents.airWaybill!;
      const before = awb.pieces;
      awb.pieces = Math.max(1, before + rng.pick([-3, -1, 1, 2, 5]));
      return { kind: this.kind, document: 'airWaybill', field: 'pieces', before, after: awb.pieces, expectedRuleIds: withNotice(s, 'T2'), description: `Air waybill says ${awb.pieces} pieces instead of ${before}.` };
    },
  },
  {
    kind: 'awb_weight_mismatch',
    applies: (s) => !!s.documents.airWaybill,
    apply(s, rng) {
      const awb = s.documents.airWaybill!;
      const before = awb.grossWeight.kg;
      awb.grossWeight = weight(fromFixed(mul(before, rng.pick(['1.06', '1.12', '0.9']))));
      if (awb.chargeableWeight && toFixed(awb.chargeableWeight.kg) < toFixed(awb.grossWeight.kg)) awb.chargeableWeight = awb.grossWeight;
      return { kind: this.kind, document: 'airWaybill', field: 'grossWeight.kg', before, after: awb.grossWeight.kg, expectedRuleIds: withNotice(s, 'T3'), description: 'Air waybill gross weight differs from the packing list.' };
    },
  },
  {
    kind: 'coo_exporter_mismatch',
    applies: (s) => !!s.documents.certificateOfOrigin,
    apply(s) {
      const coo = s.documents.certificateOfOrigin!;
      const before = coo.exporter.name;
      coo.exporter = OTHER_EXPORTER;
      return { kind: this.kind, document: 'certificateOfOrigin', field: 'exporter.name', before, after: coo.exporter.name, expectedRuleIds: ['T7'], description: 'Certificate of origin made out by another exporter.' };
    },
  },
  {
    kind: 'coo_hs_mismatch',
    applies: (s) => !!s.documents.certificateOfOrigin?.goods[0].hsCode,
    apply(s) {
      const coo = s.documents.certificateOfOrigin!;
      const before = coo.goods[0].hsCode!;
      const used = new Set(coo.goods.map((g) => hsHeading(g.hsCode)));
      const after = hsDotted(['392690', '940360', '851660', '420292', '732690'].find((h) => !used.has(h) && !s.documents.invoice.lines.some((l) => hsHeading(l.hsCode) === h))!);
      coo.goods[0].hsCode = after;
      return { kind: this.kind, document: 'certificateOfOrigin', field: 'goods[0].hsCode', before, after, expectedRuleIds: ['T8'], description: `Certificate of origin lists HS ${after} instead of ${before}.` };
    },
  },
  {
    kind: 'cusma_missing_element',
    applies: (s) => !!s.documents.cusmaCertification,
    apply(s) {
      const c = s.documents.cusmaCertification!;
      const before = c.goods[0].originCriterion;
      delete c.goods[0].originCriterion;
      return { kind: this.kind, document: 'cusmaCertification', field: 'goods[0].originCriterion', before, after: null, expectedRuleIds: ['T9'], description: 'CUSMA certification without the origin criterion of the first good.' };
    },
  },
  {
    kind: 'dg_declaration_missing',
    applies: (s) => !!s.documents.dangerousGoods,
    apply(s) {
      delete s.documents.dangerousGoods;
      return { kind: this.kind, document: 'invoice', field: 'lines[0].description', before: 'declared', after: null, expectedRuleIds: ['T10'], description: 'Lithium batteries on the invoice, no dangerous goods declaration.' };
    },
  },
  {
    kind: 'ispm15_missing',
    applies: (s) => !!s.documents.woodPackaging,
    apply(s) {
      delete s.documents.woodPackaging;
      const field = s.documents.airWaybill ? 'natureOfGoods' : 'cargoDescription';
      return { kind: this.kind, document: s.documents.airWaybill ? 'airWaybill' : 'billOfLading', field, before: 'certificate', after: null, expectedRuleIds: ['T11'], description: 'Wooden packaging declared, no ISPM 15 certificate.' };
    },
  },
  {
    kind: 'arrival_notice_mismatch',
    applies: (s) => s.documents.arrivalNotice?.packages !== undefined,
    apply(s, rng) {
      const an = s.documents.arrivalNotice!;
      const before = an.packages!;
      an.packages = before + rng.pick([-2, 1, 3]);
      return { kind: this.kind, document: 'arrivalNotice', field: 'packages', before, after: an.packages, expectedRuleIds: ['T12'], description: `Arrival notice says ${an.packages} packages instead of ${before}.` };
    },
  },
  {
    kind: 'coo_unsigned',
    applies: (s) => !!s.documents.certificateOfOrigin,
    apply(s) {
      s.attestations.certificateOfOrigin = { signature: false, stamp: false };
      return { kind: this.kind, document: 'certificateOfOrigin', field: 'attestation', before: 'signed and stamped', after: 'blank', expectedRuleIds: ['T13'], description: 'Certificate of origin printed without signature or stamp.' };
    },
  },
];

/** Builds v1-docs from the v1 entries: `count` shipments, half per destination, from their clean versions. */
export function buildDocsDataset(entries: DatasetEntry[], count = 40): DocsEntry[] {
  const pick = (d: string) => entries.filter((e) => e.shipment.destination === d).slice(0, Math.ceil(count / 2));
  return [...pick('CA'), ...pick('US')].slice(0, count).map((e) => {
    const rng = new Rng(e.clean.seed ^ 0x0d0c5e75);
    const shipment = withDocuments(e.clean, rng);
    const labels: DocsLabel[] = [];
    if (rng.chance(0.75)) {
      const n = rng.chance(0.6) ? 1 : 2;
      const kinds = new Set<DocsErrorKind>();
      for (const inj of rng.sample(INJECTORS, INJECTORS.length)) {
        if (labels.length >= n) break;
        // T2 and T3 both read the AWB totals; one AWB error per shipment keeps the labels apart.
        if (!inj.applies(shipment) || (inj.kind.startsWith('awb_') && [...kinds].some((k) => k.startsWith('awb_')))) continue;
        labels.push(inj.apply(shipment, rng));
        kinds.add(inj.kind);
      }
    }
    return { shipment, labels };
  });
}

/** Injects one error kind by name, for tests. */
export function injectDocsError(s: DocsShipment, kind: DocsErrorKind, rng = new Rng(1)): DocsLabel | undefined {
  const inj = INJECTORS.find((i) => i.kind === kind)!;
  return inj.applies(s) ? inj.apply(s, rng) : undefined;
}

/** The rule engine's context for a v1-docs shipment, each document cited by its key, with what its paper shows. */
export function docsContext(s: DocsShipment, docs: Partial<DocsDocuments> = s.documents): ShipmentContext {
  const ctx: ShipmentContext = { shipmentId: s.id, destination: s.destination };
  for (const [key, data] of Object.entries(docs)) if (data) Object.assign(ctx, { [key]: { id: key, data } });
  const attestations = Object.fromEntries(Object.entries(s.attestations).filter(([key]) => (docs as Record<string, unknown>)[key]));
  if (Object.keys(attestations).length) ctx.attestations = attestations;
  return ctx;
}
