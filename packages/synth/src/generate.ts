import { EU_MEMBER_STATES, fromFixed, iso6346CheckDigit, mul, toFixed } from '@doccheck/rules';
import type {
  BillOfLading,
  CommercialInvoice,
  Container,
  Destination,
  Incoterm,
  InvoiceLine,
  Isf,
  PackageGroup,
  PackingList,
  Party,
  Weight,
} from '@doccheck/schemas';
import { BUYERS, CARRIERS, CONTAINER_TYPES, FORWARDERS, SELLERS, type Buyer, type Product, type Seller } from './catalog';
import { VARIANT_COLOURS, VARIANT_SIZES } from './catalog-v2';
import { Rng } from './rng';

/** How a shipment is drawn as PDFs. Chosen at generation time so the truth file records it. */
export interface RenderOptions {
  invoiceTemplate: string;
  packingListTemplate: string;
  blTemplate: string;
  /** Unit printed on the BL weights. Values stay normalized to kg in the JSON. */
  blWeightUnit: 'KG' | 'LB';
  /** Print an English/French bilingual invoice (allowed by CBSA). */
  bilingual: boolean;
  /** ISF confirmation template; only set in data/eval/v1-isf. */
  isfTemplate?: string;
}

export interface ShipmentDocuments {
  invoice: CommercialInvoice;
  packingList: PackingList;
  billOfLading: BillOfLading;
  /** Only for US ocean imports. */
  isf?: Isf;
}

export interface SyntheticShipment {
  id: string;
  seed: number;
  destination: Destination;
  documents: ShipmentDocuments;
  render: RenderOptions;
}

export const TEMPLATES = {
  invoice: ['classic', 'modern', 'legacy'],
  packingList: ['classic', 'modern', 'legacy'],
  billOfLading: ['classic', 'modern', 'legacy'],
} as const;

/**
 * Knobs for sets after v1. Every option defaults to v1 behaviour, and the extra random draws come
 * from a separate generator, so v1 shipments stay byte-identical.
 */
export interface GenerateOptions {
  sellers?: Seller[];
  buyers?: Buyer[];
  templates?: { invoice: readonly string[]; packingList: readonly string[]; billOfLading: readonly string[] };
  /** Split each product into colour/size/lot variants, so line tables run over several pages. */
  variants?: { min: number; max: number };
}

const LB_PER_KG = '2.20462';

/**
 * Destination-specific invoice details, drawn from their own generator so the shared draws stay put.
 * MX: about half the invoices are in Spanish (English and French are accepted too). GB: goods of EU
 * origin carry the TCA statement on origin, with the exporter's REX number.
 */
function addDestinationDetails(invoice: CommercialInvoice, destination: Destination, rng: Rng) {
  if (destination === 'MX') invoice.language = rng.chance(0.5) ? 'es' : 'en';
  const origin = invoice.seller.address.country!;
  if (destination === 'GB' && EU_MEMBER_STATES.includes(origin)) {
    const rex = `${origin}REX${String(rng.int(100000000, 999999999))}`;
    invoice.originStatement = `The exporter of the products covered by this document (Exporter Reference No ${rex}) declares that, except where otherwise clearly indicated, these products are of EU preferential origin.`;
  }
}
const VESSELS = ['PACIFIC CREST HARMONY', 'MERIDIAN STAR', 'AURORA BOREAS', 'TIDEWATER SPIRIT', 'NORTHERN VEGA', 'CAPE ALBATROSS'];

/** kg weight with the original unit; `rawUnit` LB converts the printed value, kg stays exact. */
export function weight(kg: string, rawUnit: 'KG' | 'LB' = 'KG'): Weight {
  if (rawUnit === 'KG') return { kg, raw: { value: kg, unit: 'KG' } };
  return { kg, raw: { value: fromFixed(mul(kg, LB_PER_KG), 0), unit: 'LB' } };
}

const add = (values: string[], decimals = 2) => fromFixed(values.reduce((acc, v) => acc + toFixed(v), 0n), decimals);
const times = (value: string, n: number | string, decimals = 2) => fromFixed(mul(value, String(n)), decimals);
const pad = (n: number, width: number) => String(n).padStart(width, '0');

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function containerNumber(ownerCode: string, serial: number): string {
  const first10 = `${ownerCode}${pad(serial, 6)}`;
  return `${first10}${iso6346CheckDigit(first10)}`;
}

/** Packages per order line, sized so a shipment fills between a part of a 20' and a few 40' boxes. */
function packageCountFor(product: Product, rng: Rng): number {
  switch (product.packageType) {
    case 'PLT': return rng.int(4, 18);
    case 'CRT': return rng.int(8, 60);
    case 'BAG': return rng.int(40, 300);
    default: return rng.int(10, 240);
  }
}

interface LineDraft {
  product: Product;
  packages: number;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  netPerPackage: string;
  grossPerPackage: string;
  /** Product name without the variant, for the bill of lading's summary description. */
  baseDescription?: string;
}

function draftLine(product: Product, rng: Rng): LineDraft {
  const packages = packageCountFor(product, rng);
  const quantity = String(packages * product.unitsPerPackage);
  const unitPrice = fromFixed(BigInt(rng.int(product.priceCents[0], product.priceCents[1])) * 10_000n);
  const netPerPackage = times(product.netKgPerUnit, product.unitsPerPackage);
  return {
    product,
    packages,
    quantity,
    unitPrice,
    lineTotal: times(quantity, unitPrice),
    netPerPackage,
    grossPerPackage: add([netPerPackage, product.tareKg]),
  };
}

/** Fills containers in order, so each box carries whole packages and the weights add up exactly. */
function stuffContainers(lines: LineDraft[], ownerCode: string, rng: Rng, blUnit: 'KG' | 'LB'): Container[] {
  const volumeM3 = lines.reduce((acc, l) => acc + (l.packages * l.product.dimensionsCm.reduce((a, b) => a * b, 1)) / 1e6, 0);
  const grossKg = Number(add(lines.map((l) => times(l.grossPerPackage, l.packages))));
  const type = volumeM3 < 24 && grossKg < 20000 ? CONTAINER_TYPES[0] : rng.pick(CONTAINER_TYPES.slice(1));
  const count = Math.max(1, Math.ceil(volumeM3 / (type.capacityM3 * 0.9)), Math.ceil(grossKg / type.maxKg));

  const perPackage = lines.flatMap((l) => Array.from({ length: l.packages }, () => l));
  const size = Math.ceil(perPackage.length / count);
  const serialBase = rng.int(100000, 990000);
  return Array.from({ length: count }, (_, i) => {
    const slice = perPackage.slice(i * size, (i + 1) * size);
    const vol = slice.reduce((acc, l) => acc + l.product.dimensionsCm.reduce((a, b) => a * b, 1) / 1e6, 0);
    return {
      number: containerNumber(ownerCode, serialBase + i * 100 + rng.int(0, 99)),
      seal: `${ownerCode.slice(0, 2)}${rng.int(1000000, 9999999)}`,
      type: type.type,
      packages: slice.length,
      grossWeight: weight(add(slice.map((l) => l.grossPerPackage)), blUnit),
      volumeM3: vol.toFixed(2),
    };
  }).filter((c) => c.packages > 0);
}

/** One line per variant of the product: the same goods in another colour, size or lot. */
function splitVariants(lines: LineDraft[], rng: Rng, range: { min: number; max: number }): LineDraft[] {
  return lines.flatMap((l) => {
    const p = l.product;
    const apparel = /^6[12]/.test(p.hsCode);
    const food = /^(09|15)/.test(p.hsCode);
    const n = rng.int(range.min, range.max);
    const labels = apparel
      ? rng.sample(VARIANT_COLOURS.flatMap(([c, colour]) => VARIANT_SIZES.map((size) => [`${c}-${size}`, `colour ${colour}, size ${size}`] as const)), n)
      : food
        ? Array.from({ length: n }, (_, i) => [`L${i + 1}`, `lot ${String.fromCharCode(65 + i)}-${rng.int(100, 999)}`] as const)
        : rng.sample([...VARIANT_COLOURS], Math.min(n, VARIANT_COLOURS.length)).map(([c, colour]) => [c, `colour ${colour}`] as const);
    return labels.map(([code, label]) => {
      const product: Product = { ...p, sku: `${p.sku}-${code}`, description: `${p.description}, ${label}`, shortDescription: `${p.shortDescription} ${label}` };
      const packages = rng.int(1, Math.max(2, Math.ceil((l.packages * 1.5) / n)));
      const quantity = String(packages * p.unitsPerPackage);
      return { ...l, product, packages, quantity, lineTotal: times(quantity, l.unitPrice), baseDescription: p.shortDescription };
    });
  });
}

function shortName(party: Party): string {
  return party.name.split(/[\s,.]+/).filter((w) => w.length > 2)[0].toUpperCase();
}

/**
 * Whether a seller fits a destination: an import must cross a customs border (no EU seller for the
 * EU), and the value data of a Mexican import carries the seller's tax number (RGCE regla 1.9.19). CA and US take every
 * seller, so their shipments stay as they were.
 */
function sellsTo(seller: Seller, destination: Destination): boolean {
  const country = seller.party.address.country!;
  if (destination === 'EU') return !EU_MEMBER_STATES.includes(country);
  if (destination === 'GB') return country !== 'GB';
  if (destination === 'MX') return country !== 'MX' && !!seller.party.taxId;
  return true;
}

/** Builds one clean, internally consistent shipment. Every shared rule must pass on it. */
export function generateShipment(id: string, destination: Destination, seed: number, opts: GenerateOptions = {}): SyntheticShipment {
  const rng = new Rng(seed);
  // Catalog parties always carry their country (the schema allows it to be absent for scans).
  const countryOf = (p: Party) => p.address.country!;
  const templates = opts.templates ?? TEMPLATES;
  const buyer = rng.pick((opts.buyers ?? BUYERS).filter((b) => b.destination === destination));
  const seller = rng.pick((opts.sellers ?? SELLERS).filter((s) => sellsTo(s, destination)));
  const carrier = rng.pick(CARRIERS);
  const forwarder = rng.pick(FORWARDERS);
  const portOfLoading = rng.pick(seller.ports);
  const portOfDischarge = rng.pick(buyer.portsOfDischarge);
  const currency = seller.currencies.includes('EUR') && rng.chance(0.6) ? 'EUR' : rng.pick(buyer.currencies);

  const render: RenderOptions = {
    invoiceTemplate: rng.pick(templates.invoice),
    packingListTemplate: rng.pick(templates.packingList),
    blTemplate: rng.pick(templates.billOfLading),
    blWeightUnit: destination === 'US' && rng.chance(0.4) ? 'LB' : 'KG',
    bilingual: destination === 'CA' && buyer.party.address.region === 'QC' && rng.chance(0.7),
  };

  const products = rng.sample(seller.products, rng.int(1, Math.min(4, seller.products.length)));
  let lines = products.map((p) => draftLine(p, rng));
  if (opts.variants) lines = splitVariants(lines, new Rng(seed ^ 0x2c1b3c6d), opts.variants);
  const totalPackages = lines.reduce((acc, l) => acc + l.packages, 0);
  const netKg = add(lines.map((l) => times(l.netPerPackage, l.packages)));
  const grossKg = add(lines.map((l) => times(l.grossPerPackage, l.packages)));
  const invoiceTotal = add(lines.map((l) => l.lineTotal));

  const year = 2026;
  const invoiceDate = addDays(`${year}-01-05`, rng.int(0, 260));
  const shipmentDate = addDays(invoiceDate, rng.int(2, 12));
  const seq = rng.int(100, 9999);
  const invoiceNumber = rng.pick([`INV-${year}-${pad(seq, 4)}`, `${shortName(seller.party).slice(0, 3)}${String(year).slice(2)}${pad(seq, 5)}`, `CI/${String(year).slice(2)}/${pad(seq, 4)}`]);
  const poNumber = rng.pick([`PO-${rng.int(1000, 99999)}`, `${shortName(buyer.party).slice(0, 2)}${rng.int(100000, 999999)}`]);
  const consignee = buyer.shipTo && rng.chance(0.5) ? buyer.shipTo : buyer.party;
  const incoterm = rng.pick<Incoterm>(['FOB', 'FOB', 'FCA', 'CIF', 'CFR', 'EXW']);
  const packageTypes = new Set(lines.map((l) => l.product.packageType));
  const packageWord = packageTypes.size > 1 ? 'PKGS' : lines[0].product.packageType === 'CTN' ? 'CTNS' : `${lines[0].product.packageType}S`;
  const marks = `${shortName(buyer.party)}/${poNumber}/C/NO. 1-${totalPackages}`;

  const invoiceLines: InvoiceLine[] = lines.map((l, i) => ({
    lineNo: i + 1,
    sku: l.product.sku,
    description: l.product.description,
    quantity: { value: l.quantity, unit: l.product.unit },
    unitPrice: { amount: l.unitPrice, currency },
    lineTotal: { amount: l.lineTotal, currency },
    countryOfOrigin: seller.party.address.country,
    hsCode: l.product.hsCode,
  }));

  const invoice: CommercialInvoice = {
    invoiceNumber,
    invoiceDate,
    poNumber,
    seller: seller.party,
    buyer: buyer.party,
    consignee,
    exporter: seller.party,
    shipmentDate,
    transport: { mode: 'SEA', placeOfShipment: portOfLoading },
    incoterm: { code: incoterm, place: incoterm === 'CIF' || incoterm === 'CFR' ? portOfDischarge.name : portOfLoading.name },
    paymentTerms: rng.pick(['T/T 30 days after BL date', 'T/T 30% deposit, 70% against copy of BL', 'L/C at sight', 'Net 60']),
    currency,
    packageCount: totalPackages,
    lines: invoiceLines,
    grossWeight: weight(grossKg),
    netWeight: weight(netKg),
    invoiceTotal: { amount: invoiceTotal, currency },
    responsiblePerson: rng.pick(['Export Manager', 'Sales Director', 'Shipping Supervisor']),
    language: render.bilingual ? 'fr' : 'en',
  };
  if (destination === 'US') invoice.portOfEntry = portOfDischarge;
  if (destination === 'MX' || destination === 'GB') addDestinationDetails(invoice, destination, new Rng(seed ^ 0x6d2b79f5));

  let firstPackage = 1;
  const packages: PackageGroup[] = lines.map((l) => {
    const range = `${firstPackage}-${firstPackage + l.packages - 1}`;
    firstPackage += l.packages;
    return {
      range,
      count: l.packages,
      type: l.product.packageType,
      marks,
      contents: [{ sku: l.product.sku, description: l.product.shortDescription, quantity: { value: l.quantity, unit: l.product.unit } }],
      netWeight: weight(times(l.netPerPackage, l.packages)),
      grossWeight: weight(times(l.grossPerPackage, l.packages)),
      dimensionsCm: l.product.dimensionsCm,
    };
  });
  const volumeM3 = lines.reduce((acc, l) => acc + (l.packages * l.product.dimensionsCm.reduce((a, b) => a * b, 1)) / 1e6, 0);

  const packingList: PackingList = {
    packingListNumber: /^(INV|CI)/.test(invoiceNumber) ? invoiceNumber.replace(/^(INV|CI)/, 'PL') : `PL-${invoiceNumber}`,
    invoiceRef: invoiceNumber,
    seller: seller.party,
    consignee,
    packages,
    totals: { packageCount: totalPackages, netWeight: weight(netKg), grossWeight: weight(grossKg), volumeM3: volumeM3.toFixed(2) },
  };

  const isHouse = rng.chance(0.5);
  const ownerCode = rng.pick(carrier.ownerCodes);
  const blNumber = isHouse
    ? `${shortName(forwarder).slice(0, 4)}${portOfLoading.unLocode!.slice(2)}${rng.int(100000, 999999)}`
    : `${carrier.blPrefix}${portOfLoading.unLocode!.slice(2)}${rng.int(1000000, 9999999)}`;
  const onBoard = addDays(shipmentDate, rng.int(0, 3));
  const goods = (lines[0].baseDescription ?? lines[0].product.shortDescription).toUpperCase();
  const describe = lines.length === 1 ? goods : `${goods} AND OTHER GOODS AS PER INVOICE`;

  const billOfLading: BillOfLading = {
    blNumber,
    blType: { issuer: isHouse ? 'HBL' : 'MBL', form: rng.chance(0.6) ? 'ORIGINAL' : 'SEAWAY' },
    bookingNumber: String(rng.int(100000000, 999999999)),
    carrier: { name: carrier.name, scac: carrier.scac },
    shipper: seller.party,
    consignee,
    notifyParty: buyer.party,
    vessel: rng.pick(VESSELS),
    voyage: `${pad(rng.int(1, 99), 3)}${rng.pick(['E', 'W', 'N', 'S'])}`,
    placeOfReceipt: { name: seller.party.address.city ?? portOfLoading.name, country: countryOf(seller.party) },
    portOfLoading,
    portOfDischarge,
    placeOfDelivery: buyer.placeOfDelivery,
    containers: stuffContainers(lines, ownerCode, rng, render.blWeightUnit),
    totalPackages,
    totalGrossWeight: weight(grossKg, render.blWeightUnit),
    marksAndNumbers: marks,
    cargoDescription: `SAID TO CONTAIN ${totalPackages} ${packageWord} ${describe}`,
    freightTerms: incoterm === 'CIF' || incoterm === 'CFR' ? 'PREPAID' : 'COLLECT',
    placeOfIssue: portOfLoading.name,
    dateOfIssue: onBoard,
    shippedOnBoardDate: onBoard,
    references: [invoiceNumber, poNumber],
  };

  const documents: ShipmentDocuments = { invoice, packingList, billOfLading };
  if (destination === 'US') {
    const irs = `${buyer.party.taxId}00`;
    const manufacturer = seller.manufacturer ?? seller.party;
    documents.isf = {
      seller: seller.party,
      buyer: buyer.party,
      importerOfRecordNumber: irs,
      consigneeNumber: irs,
      manufacturer,
      shipToParty: buyer.shipTo ?? buyer.party,
      countryOfOrigin: countryOf(seller.party),
      htsCode: lines[0].product.hsCode.replace('.', ''),
      containerStuffingLocation: manufacturer.address,
      consolidator: forwarder,
    };
  }

  return { id, seed, destination, documents, render };
}
