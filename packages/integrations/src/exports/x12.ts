import type { Party } from '@doccheck/schemas';
import { ExportInputError, fileSafe, type ExportFile, type ExportInput } from './input';

/**
 * ANSI X12 (version 004010) from the extracted documents:
 * - 856 Ship Notice/Manifest (ASN): shipment, order and item levels (HL S/O/I), with the BL, containers,
 *   packages, weight and parties, and one item per invoice line.
 *   An air shipment uses the air waybill: transport method A, REF AW, pieces and weight, no containers.
 * - 310 Freight Receipt and Invoice (Ocean): the bill of lading as a carrier sends it, with vessel,
 *   ports, parties, one LX loop per container and totals.
 *
 * Separators: "*" between elements, ">" between components, "~" ends a segment (a newline follows
 * each one for readability; partners that need none can strip them). Values never contain them.
 * Interchange ids, qualifiers and control numbers come from the options; agree them with the
 * trading partner, whose implementation guide may require more segments.
 */
export interface X12Options {
  senderId?: string;
  receiverId?: string;
  /** Interchange control number, 1 to 999999999. */
  controlNumber?: number;
  /** P: production, T: test (the default: nothing is sent anywhere by building a file). */
  usage?: 'P' | 'T';
}

const UNIT: Record<string, string> = { PCS: 'PC', PC: 'PC', EA: 'EA', SET: 'SET', SETS: 'SET', KG: 'KG', KGS: 'KG', LB: 'LB', LBS: 'LB', CTN: 'CT', CTNS: 'CT', PR: 'PR', PAIRS: 'PR', DZ: 'DZ', M: 'MR', M2: 'SM', M3: 'CR' };
const PACKAGING: Record<string, string> = { CTN: 'CTN', PLT: 'PLT', BAG: 'BAG', CRT: 'CRT', DRM: 'DRM', OTHER: 'PKG' };

const clean = (v: string | number | undefined | null) => (v === undefined || v === null ? '' : String(v).replace(/[*~>^\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
const pad = (v: string, n: number) => clean(v).slice(0, n).padEnd(n, ' ');
const yymmdd = (d: Date) => d.toISOString().slice(2, 10).replace(/-/g, '');
const ccyymmdd = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10)).replace(/-/g, '');
const hhmm = (d: Date) => d.toISOString().slice(11, 16).replace(':', '');

class Segments {
  readonly list: string[] = [];
  add(id: string, ...elements: (string | number | undefined | null)[]) {
    const values = elements.map(clean);
    while (values.length && values.at(-1) === '') values.pop();
    this.list.push([id, ...values].join('*'));
  }
}

function envelope(functional: 'SH' | 'IO', set: '856' | '310', body: Segments, opts: X12Options, now: Date): string {
  const control = String(opts.controlNumber ?? 1).padStart(9, '0').slice(-9);
  const group = String(opts.controlNumber ?? 1);
  const sender = opts.senderId ?? 'DOCCHECK';
  const receiver = opts.receiverId ?? 'RECEIVER';
  const st = new Segments();
  st.add('ST', set, '0001');
  st.list.push(...body.list);
  st.add('SE', st.list.length + 1, '0001');
  // ISA has fixed-width fields; its last element is the component separator itself.
  const isa = ['ISA', '00', pad('', 10), '00', pad('', 10), 'ZZ', pad(sender, 15), 'ZZ', pad(receiver, 15), yymmdd(now), hhmm(now), 'U', '00401', control, '0', opts.usage ?? 'T', '>'].join('*');
  const out = new Segments();
  out.list.push(isa);
  out.add('GS', functional, sender, receiver, ccyymmdd(now), hhmm(now), group, 'X', '004010');
  out.list.push(...st.list);
  out.add('GE', 1, group);
  out.add('IEA', 1, control);
  return out.list.map((s) => `${s}~`).join('\n') + '\n';
}

function party(s: Segments, code: string, p: Party | undefined) {
  if (!p) return;
  s.add('N1', code, p.name);
  if (p.address.lines.length) s.add('N3', p.address.lines[0], p.address.lines[1]);
  if (p.address.city || p.address.country) s.add('N4', p.address.city, p.address.region, p.address.postalCode, p.address.country);
}

/** Container number "MSCU1234567" as X12 equipment initial and number. */
const equipment = (n: string) => [n.slice(0, 4), n.slice(4)] as const;

export function x12Asn856(input: ExportInput, opts: X12Options = {}): ExportFile {
  const { invoice: inv, packingList: pl, billOfLading: bl, airWaybill: awb, shipment } = input;
  if (!bl && !awb && !inv) throw new ExportInputError('An 856 needs at least the bill of lading, the air waybill or the commercial invoice');
  const now = new Date(input.createdAt ?? Date.now());
  const s = new Segments();
  s.add('BSN', '00', shipment.reference || shipment.id.slice(0, 30), ccyymmdd(now), hhmm(now), '0001');
  let hl = 0;
  const shipmentHl = ++hl;
  s.add('HL', shipmentHl, '', 'S');
  const packs = bl?.totalPackages ?? awb?.pieces ?? pl?.totals.packageCount ?? inv?.packageCount;
  const packType = pl?.packages[0] ? PACKAGING[pl.packages[0].type] : 'PKG';
  const weight = bl?.totalGrossWeight.kg ?? awb?.grossWeight.kg ?? pl?.totals.grossWeight?.kg ?? inv?.grossWeight?.kg;
  if (packs !== undefined || weight) s.add('TD1', packType, packs, '', '', '', weight ? 'G' : '', weight, weight ? 'KG' : '');
  if (bl) s.add('TD5', 'B', bl.carrier?.scac ? '2' : '', bl.carrier?.scac, 'O', bl.carrier?.name);
  else if (awb) s.add('TD5', 'B', '', '', 'A', awb.carrier?.name);
  for (const c of bl?.containers ?? []) {
    const [initial, number] = equipment(c.number);
    s.add('TD3', 'CN', initial, number, '', '', '', '', '', c.seal);
  }
  if (bl) s.add('REF', 'BM', bl.blNumber);
  if (awb) s.add('REF', 'AW', awb.awbNumber);
  if (bl?.bookingNumber) s.add('REF', 'BN', bl.bookingNumber);
  if (inv) s.add('REF', 'IV', inv.invoiceNumber);
  const shipped = bl?.shippedOnBoardDate ?? awb?.flights?.[0]?.date ?? awb?.executedOn ?? inv?.shipmentDate;
  if (shipped) s.add('DTM', '011', ccyymmdd(shipped));
  party(s, 'SF', bl?.shipper ?? awb?.shipper ?? inv?.seller);
  party(s, 'ST', bl?.consignee ?? awb?.consignee ?? inv?.consignee ?? inv?.buyer);
  party(s, 'SE', inv?.seller);
  party(s, 'BY', inv?.buyer);
  if (inv) {
    const orderHl = ++hl;
    s.add('HL', orderHl, shipmentHl, 'O');
    s.add('PRF', inv.poNumber || inv.invoiceNumber, '', '', inv.invoiceDate ? ccyymmdd(inv.invoiceDate) : '');
    for (const l of inv.lines) {
      s.add('HL', ++hl, orderHl, 'I');
      s.add('LIN', l.lineNo, ...(l.sku ? ['SK', l.sku] : []), ...(l.hsCode ? ['HC', l.hsCode.replace(/\./g, '')] : []));
      s.add('SN1', '', l.quantity.value, UNIT[l.quantity.unit.toUpperCase()] ?? 'EA');
      s.add('PID', 'F', '', '', '', l.description);
    }
  }
  s.add('CTT', hl);
  const name = fileSafe(shipment.reference || bl?.blNumber || awb?.awbNumber || inv?.invoiceNumber || shipment.id);
  return { format: 'x12-856', fileName: `${name}.856.x12`, contentType: 'application/edi-x12', body: envelope('SH', '856', s, opts, now) };
}

export function x12Ocean310(input: ExportInput, opts: X12Options = {}): ExportFile {
  const { billOfLading: bl, shipment, invoice: inv } = input;
  if (!bl && input.airWaybill) throw new ExportInputError('A 310 is an ocean bill of lading and this shipment travels on an air waybill: export the 856 or CargoWise XML instead');
  if (!bl) throw new ExportInputError('A 310 is a bill of lading: the shipment needs one');
  const now = new Date(input.createdAt ?? Date.now());
  const s = new Segments();
  s.add('B3', '', bl.blNumber, shipment.reference || '', bl.freightTerms === 'COLLECT' ? 'CC' : 'PP', '', ccyymmdd(bl.dateOfIssue ?? now), '', '', '', '', bl.carrier?.scac);
  s.add('N9', 'BM', bl.blNumber);
  if (bl.bookingNumber) s.add('N9', 'BN', bl.bookingNumber);
  if (inv) s.add('N9', 'IV', inv.invoiceNumber);
  for (const r of bl.references ?? []) s.add('N9', 'ZZ', r);
  if (bl.vessel || bl.voyage) s.add('V1', '', bl.vessel, '', bl.voyage, bl.carrier?.scac);
  const port = (fn: string, loc: { name: string; unLocode?: string } | undefined) => loc && s.add('R4', fn, loc.unLocode ? 'UN' : '', loc.unLocode, loc.name);
  port('R', bl.placeOfReceipt);
  port('L', bl.portOfLoading);
  port('D', bl.portOfDischarge);
  port('E', bl.placeOfDelivery);
  if (bl.shippedOnBoardDate) s.add('DTM', '140', ccyymmdd(bl.shippedOnBoardDate));
  party(s, 'SH', bl.shipper);
  party(s, 'CN', bl.consignee);
  party(s, 'N1', bl.notifyParty);
  const containers = bl.containers.length ? bl.containers : [undefined];
  containers.forEach((c, i) => {
    s.add('LX', i + 1);
    if (c) {
      const [initial, number] = equipment(c.number);
      s.add('N7', initial, number, c.grossWeight?.kg, c.grossWeight ? 'G' : '', '', '', '', '', '', '', 'CN', '', '', '', '', '', '', '', '', '', '', c.type);
      if (c.seal) s.add('M7', c.seal);
    }
    s.add('L0', i + 1, '', '', c?.grossWeight?.kg ?? (containers.length === 1 ? bl.totalGrossWeight.kg : ''), c?.grossWeight || containers.length === 1 ? 'G' : '', '', '', c?.packages ?? (containers.length === 1 ? bl.totalPackages : ''), 'PKG', '', 'K');
    if (i === 0) s.add('L5', 1, bl.cargoDescription);
  });
  s.add('L3', bl.totalGrossWeight.kg, 'G', '', '', '', '', '', '', '', '', bl.totalPackages, '', 'K');
  const name = fileSafe(shipment.reference || bl.blNumber);
  return { format: 'x12-310', fileName: `${name}.310.x12`, contentType: 'application/edi-x12', body: envelope('IO', '310', s, opts, now) };
}
