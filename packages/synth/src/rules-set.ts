import { CONTAINER_SPECS, containerTypeOf, fromFixed, isKnownLocode, mul, productKey, runRules, toFixed, type AccountHistory, type PricePoint, type RuleParams, type ShipmentContext } from '@doccheck/rules';
import type { Finding, Party } from '@doccheck/schemas';
import { CARRIERS } from './catalog';
import type { SyntheticShipment } from './generate';
import { Rng } from './rng';

/**
 * Set "v1-rules": ground truth for the rules added after v1 (X13–X24, C3, U2–U4). The v1 shipments
 * were generated before those rules and miss what they read (vessel IMO, VGM, ISF filing time,
 * account history) or carry made-up identifiers (Business Numbers that fail their check digit,
 * fictional SCACs). So each clean v1 shipment is first completed with realistic values, deterministically
 * from its seed, and given an account history (past prices, earlier invoices, its purchase order). An
 * error of one kind is then injected at a time, as for the extra v1 kinds. Nothing here changes v1.
 */

export type RulesErrorKind =
  | 'locode_typo'
  | 'port_mismatch'
  | 'vessel_imo_typo'
  | 'scac_unknown'
  | 'invoice_future_date'
  | 'onboard_after_eta'
  | 'duplicate_invoice'
  | 'uom_mismatch'
  | 'container_over_capacity'
  | 'vgm_mismatch'
  | 'bl_originals'
  | 'incoterm_charges'
  | 'price_undervalued'
  | 'po_mismatch'
  | 'bn_check_digit'
  | 'isf_element_missing'
  | 'isf_late'
  | 'importer_number_format';

export interface RulesLabel {
  kind: RulesErrorKind;
  /** Evidence document id in the context below: invoice, packingList, billOfLading, isf, or po:<id>. */
  document: string;
  field: string;
  after: unknown;
  expectedRuleIds: string[];
  description: string;
}

/** A v1 shipment completed for the later rules, with the account it belongs to. */
export interface RulesCase {
  shipment: SyntheticShipment;
  account: AccountHistory;
}

/** The day the set is validated on: after every date the generator draws. */
export const RULES_SET_AS_OF = '2026-12-31';
/** The synthetic carriers' SCACs are made up: the account knows them, as it would know its NVOCCs'. */
export const RULES_SET_PARAMS: Partial<RuleParams> = { knownScacs: CARRIERS.map((c) => c.scac) };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const luhnDigit = (first8: string) => {
  for (let d = 0; d < 10; d++) {
    const s = `${first8}${d}`;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let v = Number(s[8 - i]);
      if (i % 2 === 1) v = v * 2 > 9 ? v * 2 - 9 : v * 2;
      sum += v;
    }
    if (sum % 10 === 0) return d;
  }
  return 0;
};
const imoFor = (rng: Rng) => {
  const six = String(rng.int(900000, 999999));
  const check = [...six].reduce((acc, ch, i) => acc + Number(ch) * (7 - i), 0) % 10;
  return `${six}${check}`;
};
const kg = (v: string) => ({ kg: v, raw: { value: v, unit: 'KG' } });
const validBn = (p: Party | undefined) => {
  if (!p?.taxId || !/^\d{9}RM\d{4}$/.test(p.taxId)) return p;
  const first8 = p.taxId.slice(0, 8);
  return { ...p, taxId: `${first8}${luhnDigit(first8)}${p.taxId.slice(9)}` };
};

/** Completes a clean v1 shipment so the later rules have what they read, and raise nothing. */
export function completeForRules(clean: SyntheticShipment): RulesCase {
  const s = structuredClone(clean);
  const rng = new Rng(s.seed ^ 0x7a11e5);
  const { invoice, packingList, billOfLading: bl, isf } = s.documents;

  // Real-looking Business Numbers: same digits, a check digit that passes.
  if (s.destination === 'CA') {
    invoice.buyer = validBn(invoice.buyer)!;
    invoice.consignee = validBn(invoice.consignee);
  }

  const onBoard = bl.shippedOnBoardDate!;
  bl.vesselImo = imoFor(rng);
  bl.estimatedArrivalDate = addDays(onBoard, rng.int(12, 32));
  bl.toOrder = false;
  if (bl.blType?.form === 'ORIGINAL') bl.numberOfOriginals = 3;
  bl.containers = bl.containers.map((c) => {
    const spec = containerTypeOf(c.type) ?? CONTAINER_SPECS['40GP'];
    const tare = spec.tareKg;
    return { ...c, tareWeight: kg(tare), vgm: kg(fromFixed(toFixed(c.grossWeight!.kg) + toFixed(tare))) };
  });

  if (isf) {
    isf.filedAt = `${addDays(onBoard, -rng.int(2, 6))}T${String(rng.int(8, 18)).padStart(2, '0')}:00:00Z`;
    isf.estimatedLoadingDate = onBoard;
    isf.blNumber = bl.blNumber;
    isf.scac = bl.carrier?.scac;
    isf.portOfLoading = bl.portOfLoading;
    isf.portOfDischarge = bl.portOfDischarge;
    isf.carrierElements = { vesselStowPlan: true, containerStatusMessages: true };
  }

  // The account: six earlier purchases of each product within ±3% of today's price, two earlier
  // invoices from the same seller, and the purchase order this invoice was raised against.
  const prices: Record<string, PricePoint[]> = {};
  invoice.lines.forEach((l) => {
    const key = productKey(l);
    if (!key) return;
    prices[key] = Array.from({ length: 6 }, (_, k) => ({
      shipmentId: `${s.id}-past-${k}`,
      documentId: `past-${k}`,
      line: 0,
      date: addDays(invoice.invoiceDate!, -30 * (k + 1)),
      unitPrice: fromFixed(mul(l.unitPrice.amount, String(1 + (rng.int(-30, 30) / 1000)))),
      currency: l.unitPrice.currency,
      unit: l.quantity.unit,
    }));
  });
  const account: AccountHistory = {
    prices,
    invoices: [1, 2].map((k) => ({ shipmentId: `${s.id}-past-${k}`, documentId: `past-${k}`, invoiceNumber: `${invoice.invoiceNumber}-P${k}`, sellerName: invoice.seller.name })),
    purchaseOrders: [
      {
        id: `${s.id}-po`,
        poNumber: invoice.poNumber!,
        sellerName: invoice.seller.name,
        currency: invoice.currency,
        lines: invoice.lines.map((l) => ({ sku: l.sku, description: l.description, quantity: l.quantity.value, unit: l.quantity.unit, unitPrice: l.unitPrice.amount })),
      },
    ],
  };
  void packingList;
  return { shipment: s, account };
}

export function rulesContext(c: RulesCase): ShipmentContext {
  const d = c.shipment.documents;
  return {
    shipmentId: c.shipment.id,
    destination: c.shipment.destination,
    invoice: { id: 'invoice', data: d.invoice },
    packingList: { id: 'packingList', data: d.packingList },
    billOfLading: { id: 'billOfLading', data: d.billOfLading },
    isf: d.isf ? { id: 'isf', data: d.isf } : undefined,
    asOf: RULES_SET_AS_OF,
    account: c.account,
  };
}

interface RulesInjector {
  kind: RulesErrorKind;
  applies(c: RulesCase): boolean;
  apply(c: RulesCase, rng: Rng): RulesLabel;
}

/** Ports with valid codes, to move a place to. */
const OTHER_PORTS = [
  { name: 'Shanghai', unLocode: 'CNSHA', country: 'CN' },
  { name: 'Busan', unLocode: 'KRPUS', country: 'KR' },
  { name: 'Singapore', unLocode: 'SGSIN', country: 'SG' },
  { name: 'Rotterdam', unLocode: 'NLRTM', country: 'NL' },
];

const INJECTORS: RulesInjector[] = [
  {
    kind: 'locode_typo',
    applies: () => true,
    apply({ shipment: s }, rng) {
      const bl = s.documents.billOfLading;
      const code = bl.portOfLoading.unLocode!;
      const bad = [...'QXZJ'].map((ch) => `${code.slice(0, 4)}${ch}`).find((c) => !isKnownLocode(c)) ?? `${code.slice(0, 2)}QQQ`;
      void rng;
      bl.portOfLoading = { ...bl.portOfLoading, unLocode: bad };
      // The invoice's place of shipment keeps the right code: X14 sees the two ports differ.
      return { kind: this.kind, document: 'billOfLading', field: 'portOfLoading.unLocode', after: bad, expectedRuleIds: ['X13', 'X14'], description: `BL port of loading ${code} mistyped as ${bad}.` };
    },
  },
  {
    kind: 'port_mismatch',
    applies: (c) => !!c.shipment.documents.invoice.transport?.placeOfShipment?.unLocode,
    apply({ shipment: s }, rng) {
      const inv = s.documents.invoice;
      const before = inv.transport!.placeOfShipment!;
      const after = rng.pick(OTHER_PORTS.filter((p) => p.unLocode !== before.unLocode));
      inv.transport = { ...inv.transport!, placeOfShipment: after };
      return { kind: this.kind, document: 'invoice', field: 'transport.placeOfShipment.unLocode', after: after.unLocode, expectedRuleIds: ['X14'], description: `Invoice place of shipment ${after.unLocode} instead of ${before.unLocode}.` };
    },
  },
  {
    kind: 'vessel_imo_typo',
    applies: () => true,
    apply({ shipment: s }, rng) {
      const bl = s.documents.billOfLading;
      const before = bl.vesselImo!;
      bl.vesselImo = `${before.slice(0, 6)}${(Number(before[6]) + rng.int(1, 9)) % 10}`;
      return { kind: this.kind, document: 'billOfLading', field: 'vesselImo', after: bl.vesselImo, expectedRuleIds: ['X15'], description: `Vessel IMO ${before} mistyped as ${bl.vesselImo}.` };
    },
  },
  {
    kind: 'scac_unknown',
    applies: (c) => !!c.shipment.documents.billOfLading.carrier?.scac,
    apply({ shipment: s }, rng) {
      const bl = s.documents.billOfLading;
      const after = rng.pick(['QXZW', 'MAE1', 'ZZQB']);
      bl.carrier = { ...bl.carrier!, scac: after };
      if (s.documents.isf) s.documents.isf.scac = after;
      return { kind: this.kind, document: 'billOfLading', field: 'carrier.scac', after, expectedRuleIds: ['X15'], description: `Carrier SCAC replaced by ${after}.` };
    },
  },
  {
    kind: 'invoice_future_date',
    applies: (c) => !!c.shipment.documents.invoice.invoiceDate,
    apply({ shipment: s }, rng) {
      const inv = s.documents.invoice;
      inv.invoiceDate = addDays(RULES_SET_AS_OF, rng.int(5, 90));
      return { kind: this.kind, document: 'invoice', field: 'invoiceDate', after: inv.invoiceDate, expectedRuleIds: ['X16'], description: `Invoice dated ${inv.invoiceDate}, after the run date.` };
    },
  },
  {
    kind: 'onboard_after_eta',
    applies: () => true,
    apply({ shipment: s }, rng) {
      const bl = s.documents.billOfLading;
      bl.estimatedArrivalDate = addDays(bl.shippedOnBoardDate!, -rng.int(1, 9));
      // Keep the ISF before the (now earlier) arrival, so only the BL dates disagree.
      if (s.documents.isf) s.documents.isf.filedAt = addDays(bl.estimatedArrivalDate, -12);
      return { kind: this.kind, document: 'billOfLading', field: 'estimatedArrivalDate', after: bl.estimatedArrivalDate, expectedRuleIds: ['X16'], description: 'BL estimated arrival before the on-board date.' };
    },
  },
  {
    kind: 'duplicate_invoice',
    applies: () => true,
    apply(c) {
      const inv = c.shipment.documents.invoice;
      c.account.invoices!.push({ shipmentId: `${c.shipment.id}-earlier`, documentId: 'earlier-invoice', invoiceNumber: inv.invoiceNumber.toLowerCase(), sellerName: inv.seller.name.toUpperCase() });
      return { kind: this.kind, document: 'invoice', field: 'invoiceNumber', after: inv.invoiceNumber, expectedRuleIds: ['X17'], description: `Invoice ${inv.invoiceNumber} already used in an earlier shipment.` };
    },
  },
  {
    kind: 'uom_mismatch',
    applies: () => true,
    apply({ shipment: s }, rng) {
      const groups = s.documents.packingList.packages;
      const i = rng.int(0, groups.length - 1);
      const q = groups[i].contents[0].quantity;
      // Same goods counted in dozens or sets on the packing list, with a figure that does not add up.
      // Dozens only for quantities of a few dozen at least: fewer dozens packed than ordered, never more.
      const after = Number(q.value) >= 36 ? rng.pick(['DZ', 'SET']) : 'SET';
      groups[i].contents[0].quantity = { value: String(Math.max(1, Math.floor(Number(q.value) / 12) - 1)), unit: after };
      return { kind: this.kind, document: 'packingList', field: `packages[${i}].contents[0].quantity.unit`, after, expectedRuleIds: ['X18'], description: `Packing list counts the item in ${after} instead of ${q.unit}.` };
    },
  },
  {
    kind: 'container_over_capacity',
    applies: (c) => c.shipment.documents.billOfLading.containers.some((k) => containerTypeOf(k.type)),
    apply({ shipment: s }, rng) {
      const containers = s.documents.billOfLading.containers;
      const i = containers.findIndex((k) => containerTypeOf(k.type));
      const spec = containerTypeOf(containers[i].type)!;
      containers[i].volumeM3 = fromFixed(toFixed(spec.capacityM3) + BigInt(rng.int(3, 20)) * 1_000_000n);
      return { kind: this.kind, document: 'billOfLading', field: `containers[${i}].volumeM3`, after: containers[i].volumeM3, expectedRuleIds: ['X19'], description: `Container declared with ${containers[i].volumeM3} m3, more than a ${spec.type} holds.` };
    },
  },
  {
    kind: 'vgm_mismatch',
    applies: () => true,
    apply({ shipment: s }, rng) {
      const containers = s.documents.billOfLading.containers;
      const i = rng.int(0, containers.length - 1);
      containers[i].vgm = kg(fromFixed(mul(containers[i].vgm!.kg, rng.pick(['1.15', '1.30', '0.85']))));
      if (toFixed(containers[i].vgm!.kg) < toFixed(containers[i].grossWeight!.kg)) containers[i].vgm = kg(containers[i].grossWeight!.kg);
      return { kind: this.kind, document: 'billOfLading', field: `containers[${i}].vgm.kg`, after: containers[i].vgm!.kg, expectedRuleIds: ['X20'], description: 'Container VGM does not match cargo weight plus tare.' };
    },
  },
  {
    kind: 'bl_originals',
    applies: () => true,
    apply({ shipment: s }) {
      const bl = s.documents.billOfLading;
      if (bl.blType?.form === 'SEAWAY') {
        bl.numberOfOriginals = 3;
        return { kind: this.kind, document: 'billOfLading', field: 'numberOfOriginals', after: 3, expectedRuleIds: ['X21'], description: 'Sea waybill stating 3 originals.' };
      }
      bl.consignee = { name: 'TO ORDER', address: { lines: [] } };
      bl.toOrder = true;
      delete bl.numberOfOriginals;
      // A to-order BL names no consignee, so X1 has nothing to compare: it skips, by design.
      return { kind: this.kind, document: 'billOfLading', field: 'numberOfOriginals', after: undefined, expectedRuleIds: ['X21'], description: 'BL consigned to order without the number of originals.' };
    },
  },
  {
    kind: 'incoterm_charges',
    applies: (c) => !!c.shipment.documents.invoice.incoterm,
    apply({ shipment: s }, rng) {
      const inv = s.documents.invoice;
      const term = inv.incoterm!.code;
      const amount = fromFixed(BigInt(rng.int(400, 3000)) * 1_000_000n);
      if (term === 'CFR') {
        inv.charges = { insurance: { amount, currency: inv.currency } };
        return { kind: this.kind, document: 'invoice', field: 'charges.insurance.amount', after: amount, expectedRuleIds: ['X22'], description: `CFR invoice charging insurance of ${amount}.` };
      }
      inv.charges = { freight: { amount, currency: inv.currency } };
      return { kind: this.kind, document: 'invoice', field: 'incoterm.code', after: term, expectedRuleIds: ['X22'], description: `${term} invoice ${term === 'CIF' ? 'itemizing freight without insurance' : 'charging ocean freight'}.` };
    },
  },
  {
    kind: 'price_undervalued',
    applies: () => true,
    apply(c, rng) {
      const inv = c.shipment.documents.invoice;
      const i = rng.int(0, inv.lines.length - 1);
      const line = inv.lines[i];
      line.unitPrice = { ...line.unitPrice, amount: fromFixed(mul(line.unitPrice.amount, rng.pick(['0.40', '0.50', '0.60']))) };
      // Totals follow, so only the price history shows the drop.
      line.lineTotal = { ...line.lineTotal, amount: fromFixed(mul(line.quantity.value, line.unitPrice.amount)) };
      inv.invoiceTotal = { ...inv.invoiceTotal, amount: fromFixed(inv.lines.reduce((acc, l) => acc + toFixed(l.lineTotal.amount), 0n)) };
      // The order was raised at the new price too: only the history shows the drop.
      const po = c.account.purchaseOrders![0];
      po.lines = po.lines.map((l) => (l.sku === line.sku ? { ...l, unitPrice: line.unitPrice.amount } : l));
      return { kind: this.kind, document: 'invoice', field: `lines[${i}].unitPrice.amount`, after: line.unitPrice.amount, expectedRuleIds: ['X23'], description: `Line ${line.lineNo} unit price cut to ${line.unitPrice.amount}.` };
    },
  },
  {
    kind: 'po_mismatch',
    applies: () => true,
    apply(c, rng) {
      const po = c.account.purchaseOrders![0];
      const j = rng.int(0, po.lines.length - 1);
      po.lines[j] = { ...po.lines[j], quantity: fromFixed(mul(po.lines[j].quantity, rng.pick(['1.20', '1.50', '2'])), 0) };
      return { kind: this.kind, document: `po:${po.id}`, field: `lines[${j}].quantity`, after: po.lines[j].quantity, expectedRuleIds: ['X24'], description: `Purchase order quantity ${po.lines[j].quantity} differs from the invoice.` };
    },
  },
  {
    kind: 'bn_check_digit',
    applies: (c) => c.shipment.destination === 'CA' && /^\d{9}RM/.test(c.shipment.documents.invoice.buyer.taxId ?? ''),
    apply({ shipment: s }, rng) {
      const inv = s.documents.invoice;
      const before = inv.buyer.taxId!;
      const after = `${before.slice(0, 8)}${(Number(before[8]) + rng.int(1, 9)) % 10}${before.slice(9)}`;
      const field = inv.consignee?.taxId === before ? 'consignee.taxId' : 'buyer.taxId';
      if (inv.consignee?.taxId === before) inv.consignee = { ...inv.consignee, taxId: after };
      inv.buyer = { ...inv.buyer, taxId: after };
      return { kind: this.kind, document: 'invoice', field, after, expectedRuleIds: ['C3'], description: `Business Number ${before} mistyped as ${after}.` };
    },
  },
  {
    kind: 'isf_element_missing',
    applies: (c) => !!c.shipment.documents.isf,
    apply({ shipment: s }, rng) {
      const isf = s.documents.isf!;
      const which = rng.pick(['consigneeNumber', 'containerStuffingLocation', 'blNumber'] as const);
      if (which === 'consigneeNumber') {
        isf.consigneeNumber = 'N/A';
        return { kind: this.kind, document: 'isf', field: 'consigneeNumber', after: 'N/A', expectedRuleIds: ['U2'], description: 'ISF consignee number left as N/A.' };
      }
      if (which === 'containerStuffingLocation') {
        isf.containerStuffingLocation = { lines: [] };
        return { kind: this.kind, document: 'isf', field: 'containerStuffingLocation', after: null, expectedRuleIds: ['U2'], description: 'ISF container stuffing location empty.' };
      }
      isf.blNumber = `${isf.blNumber}9`;
      return { kind: this.kind, document: 'isf', field: 'blNumber', after: isf.blNumber, expectedRuleIds: ['U2'], description: 'ISF filed against another bill number.' };
    },
  },
  {
    kind: 'isf_late',
    applies: (c) => !!c.shipment.documents.isf,
    apply({ shipment: s }, rng) {
      const isf = s.documents.isf!;
      isf.filedAt = `${addDays(isf.estimatedLoadingDate!, rng.int(0, 2))}T10:00:00Z`;
      return { kind: this.kind, document: 'isf', field: 'filedAt', after: isf.filedAt, expectedRuleIds: ['U3'], description: 'ISF filed on or after the loading date.' };
    },
  },
  {
    kind: 'importer_number_format',
    applies: (c) => !!c.shipment.documents.isf,
    apply({ shipment: s }, rng) {
      const isf = s.documents.isf!;
      const before = isf.importerOfRecordNumber;
      isf.importerOfRecordNumber = rng.chance(0.5) ? `07-${before.slice(3)}` : before.replace(/\D/g, '').slice(0, 10);
      return { kind: this.kind, document: 'isf', field: 'importerOfRecordNumber', after: isf.importerOfRecordNumber, expectedRuleIds: ['U4'], description: `Importer of record number ${isf.importerOfRecordNumber}.` };
    },
  },
];

export const RULES_ERROR_KINDS: RulesErrorKind[] = INJECTORS.map((i) => i.kind);

/** A copy of the case with one error of `kind`, or null when the kind does not apply to it. */
export function injectRulesError(c: RulesCase, kind: RulesErrorKind, rng: Rng): { case: RulesCase; label: RulesLabel } | null {
  const injector = INJECTORS.find((i) => i.kind === kind)!;
  const copy = structuredClone(c);
  if (!injector.applies(copy)) return null;
  return { case: copy, label: injector.apply(copy, rng) };
}

export interface RulesTally {
  kind: RulesErrorKind;
  rules: string[];
  injected: number;
  /** Every expected rule raised, citing the altered field. */
  tp: number;
  fn: number;
  /** Findings of any other rule. */
  fp: number;
  misses: string[];
  extras: string[];
}

const run = (c: RulesCase): Finding[] => runRules(rulesContext(c), RULES_SET_PARAMS).findings;

/**
 * Each kind injected alone into each completed clean v1 shipment it applies to, seeds as for the
 * extra v1 kinds. Also returns the findings raised on the completed clean shipments (should be none).
 */
export function evaluateRulesSet(cleans: SyntheticShipment[]): { tallies: RulesTally[]; cleanFindings: { id: string; rules: string[] }[] } {
  const cases = cleans.map(completeForRules);
  const cleanFindings = cases.map((c) => ({ id: c.shipment.id, rules: run(c).map((f) => f.ruleId) })).filter((r) => r.rules.length > 0);
  const tallies = RULES_ERROR_KINDS.map((kind) => {
    const t: RulesTally = { kind, rules: [], injected: 0, tp: 0, fn: 0, fp: 0, misses: [], extras: [] };
    cases.forEach((c, i) => {
      const injected = injectRulesError(c, kind, new Rng(0x7e57 + i));
      if (!injected) return;
      const { label } = injected;
      t.rules = label.expectedRuleIds;
      t.injected++;
      const findings = run(injected.case);
      const cites = (rule: string) =>
        findings.some((f) => f.ruleId === rule && f.evidence.some((ev) => ev.documentId === label.document && ev.field === label.field));
      if (label.expectedRuleIds.every(cites)) t.tp++;
      else {
        t.fn++;
        t.misses.push(`${c.shipment.id}: ${label.description} (got ${[...new Set(findings.map((f) => f.ruleId))].join(', ') || 'nothing'})`);
      }
      const others = findings.filter((f) => !label.expectedRuleIds.includes(f.ruleId));
      t.fp += others.length;
      for (const f of others) t.extras.push(`${c.shipment.id} ${f.ruleId}: ${f.message}`);
    });
    return t;
  });
  return { tallies, cleanFindings };
}
