import { fromFixed, mul } from '@doccheck/rules';
import type { SyntheticShipment } from './generate';
import { weight } from './generate';
import type { Rng } from './rng';

export type DocumentKey = 'invoice' | 'packingList' | 'billOfLading' | 'isf';

export type ErrorKind =
  | 'package_count_mismatch'
  | 'gross_weight_mismatch'
  | 'net_exceeds_gross'
  | 'line_quantity_changed'
  | 'line_total_typo'
  | 'second_currency'
  | 'container_check_digit'
  | 'consignee_address_mismatch'
  | 'packing_list_quantity_mismatch'
  | 'missing_required_field';

/** Ground truth for one injected error. The evaluation matches findings against these. */
export interface ErrorLabel {
  kind: ErrorKind;
  document: DocumentKey;
  /** Path inside the document, in the same notation rules use for evidence: "lines[0].quantity.value". */
  field: string;
  before: unknown;
  after: unknown;
  /** Rules that must flag this error, for the shipment's destination. Empty when no rule covers it. */
  expectedRuleIds: string[];
  description: string;
}

interface Injector {
  kind: ErrorKind;
  applies(s: SyntheticShipment): boolean;
  apply(s: SyntheticShipment, rng: Rng): ErrorLabel;
}

const pct = (kg: string, factor: string) => fromFixed(mul(kg, factor));

const INJECTORS: Injector[] = [
  {
    kind: 'package_count_mismatch',
    applies: () => true,
    apply(s, rng) {
      const delta = rng.pick([-10, -2, -1, 1, 1, 2, 5, 10]);
      if (rng.chance(0.6)) {
        const bl = s.documents.billOfLading;
        const before = bl.totalPackages;
        bl.totalPackages = Math.max(1, before + delta);
        return { kind: this.kind, document: 'billOfLading', field: 'totalPackages', before, after: bl.totalPackages, expectedRuleIds: ['X2'], description: `BL declares ${bl.totalPackages} packages instead of ${before}.` };
      }
      const inv = s.documents.invoice;
      const before = inv.packageCount!;
      inv.packageCount = Math.max(1, before + delta);
      return { kind: this.kind, document: 'invoice', field: 'packageCount', before, after: inv.packageCount, expectedRuleIds: ['X2'], description: `Invoice declares ${inv.packageCount} packages instead of ${before}.` };
    },
  },
  {
    kind: 'gross_weight_mismatch',
    applies: () => true,
    apply(s, rng) {
      const bl = s.documents.billOfLading;
      const before = bl.totalGrossWeight;
      const factor = rng.pick(['1.02', '1.05', '1.10', '0.97', '0.92', '0.85']);
      bl.totalGrossWeight = weight(pct(before.kg, factor), before.raw.unit as 'KG' | 'LB');
      return { kind: this.kind, document: 'billOfLading', field: 'totalGrossWeight.kg', before: before.kg, after: bl.totalGrossWeight.kg, expectedRuleIds: ['X3'], description: `BL gross weight off by a factor of ${factor} against the packing list.` };
    },
  },
  {
    kind: 'net_exceeds_gross',
    applies: (s) => !!s.documents.invoice.netWeight && !!s.documents.invoice.grossWeight,
    apply(s) {
      const inv = s.documents.invoice;
      const net = inv.netWeight!;
      inv.netWeight = inv.grossWeight;
      inv.grossWeight = net;
      return { kind: this.kind, document: 'invoice', field: 'netWeight.kg', before: net.kg, after: inv.netWeight!.kg, expectedRuleIds: ['X4'], description: 'Net and gross weight swapped on the invoice.' };
    },
  },
  {
    kind: 'line_quantity_changed',
    applies: () => true,
    apply(s, rng) {
      const i = rng.int(0, s.documents.invoice.lines.length - 1);
      const line = s.documents.invoice.lines[i];
      const before = line.quantity.value;
      const n = Number(before);
      line.quantity.value = String(rng.pick([n + 10, n - 10, n * 10, Math.floor(n / 10), n + 1].filter((v) => v > 0 && v !== n)));
      // The line total no longer matches (X5) and the invoice disagrees with the packing list (X7).
      return { kind: this.kind, document: 'invoice', field: `lines[${i}].quantity.value`, before, after: line.quantity.value, expectedRuleIds: ['X5', 'X7'], description: `Line ${line.lineNo} quantity changed without updating the line total.` };
    },
  },
  {
    kind: 'line_total_typo',
    applies: () => true,
    apply(s, rng) {
      const inv = s.documents.invoice;
      const i = rng.int(0, inv.lines.length - 1);
      const line = inv.lines[i];
      const before = line.lineTotal.amount;
      const digits = before.replace('.', '').split('');
      // Transpose two adjacent different digits, the most common keying error; fall back to a +100 bump.
      const j = digits.findIndex((d, k) => k < digits.length - 1 && d !== digits[k + 1]);
      let after: string;
      if (j >= 0) {
        [digits[j], digits[j + 1]] = [digits[j + 1], digits[j]];
        after = `${digits.slice(0, -2).join('')}.${digits.slice(-2).join('')}`.replace(/^0+(?=\d)/, '');
      } else {
        after = fromFixed(mul(before, '1') + 100_000_000n);
      }
      line.lineTotal.amount = after;
      return { kind: this.kind, document: 'invoice', field: `lines[${i}].lineTotal.amount`, before, after, expectedRuleIds: ['X5'], description: `Line ${line.lineNo} total mistyped (${before} -> ${after}).` };
    },
  },
  {
    kind: 'second_currency',
    applies: (s) => !s.documents.invoice.charges,
    apply(s, rng) {
      const inv = s.documents.invoice;
      const other = rng.pick(['CNY', 'EUR', 'CAD', 'USD', 'INR'].filter((c) => c !== inv.currency));
      const amount = fromFixed(BigInt(rng.int(800, 4500)) * 1_000_000n);
      inv.charges = { freight: { amount, currency: other } };
      return { kind: this.kind, document: 'invoice', field: 'charges.freight.currency', before: undefined, after: other, expectedRuleIds: ['X6'], description: `Freight charge of ${amount} ${other} on an invoice in ${inv.currency}.` };
    },
  },
  {
    kind: 'container_check_digit',
    applies: (s) => s.documents.billOfLading.containers.length > 0,
    apply(s, rng) {
      const containers = s.documents.billOfLading.containers;
      const i = rng.int(0, containers.length - 1);
      const before = containers[i].number;
      const digit = (Number(before[10]) + rng.int(1, 9)) % 10;
      containers[i].number = `${before.slice(0, 10)}${digit}`;
      return { kind: this.kind, document: 'billOfLading', field: `containers[${i}].number`, before, after: containers[i].number, expectedRuleIds: ['X10'], description: `Container number mistyped: ${before} -> ${containers[i].number}.` };
    },
  },
  {
    kind: 'consignee_address_mismatch',
    applies: () => true,
    apply(s, rng) {
      const bl = s.documents.billOfLading;
      const before = bl.consignee.address.lines[0];
      const after = before.replace(/\d+/, (m) => String(Number(m) + rng.int(1, 40) * 2));
      bl.consignee = { ...bl.consignee, address: { ...bl.consignee.address, lines: [after === before ? `${before} Unit ${rng.int(2, 20)}` : after, ...bl.consignee.address.lines.slice(1)] } };
      return { kind: this.kind, document: 'billOfLading', field: 'consignee.address.lines[0]', before, after: bl.consignee.address.lines[0], expectedRuleIds: ['X1'], description: 'Consignee street address on the BL differs from the invoice.' };
    },
  },
  {
    kind: 'packing_list_quantity_mismatch',
    applies: () => true,
    apply(s, rng) {
      const groups = s.documents.packingList.packages;
      const i = rng.int(0, groups.length - 1);
      const q = groups[i].contents[0].quantity;
      const before = q.value;
      const short = Number(before) - rng.pick([1, 5, 10, 24, 50]);
      q.value = String(short > 0 ? short : Number(before) + 12);
      return { kind: this.kind, document: 'packingList', field: `packages[${i}].contents[0].quantity.value`, before, after: q.value, expectedRuleIds: ['X7'], description: 'Packing list quantity differs from the invoice line.' };
    },
  },
  {
    kind: 'missing_required_field',
    applies: () => true,
    apply(s, rng) {
      const inv = s.documents.invoice;
      const completeness = s.destination === 'CA' ? 'C1' : 'U1';
      // Which rule requires the field depends on the destination: CBSA CI1 vs 19 CFR 141.86(a).
      const options = [
        () => {
          const before = inv.lines.map((l) => l.countryOfOrigin);
          inv.lines.forEach((l) => delete l.countryOfOrigin);
          return { field: 'lines[*].countryOfOrigin', before, rules: [completeness], description: 'Country of origin missing on every invoice line.' };
        },
        () => {
          const before = inv.incoterm;
          delete inv.incoterm;
          return { field: 'incoterm', before, rules: s.destination === 'CA' ? ['C1'] : [], description: 'Terms of sale (Incoterm) missing from the invoice.' };
        },
        () => {
          const before = inv.consignee;
          delete inv.consignee;
          return { field: 'consignee.name', before, rules: s.destination === 'CA' ? ['C1'] : [], description: 'Consignee missing from the invoice.' };
        },
        () => {
          const before = inv.invoiceDate;
          delete inv.invoiceDate;
          return { field: 'invoiceDate', before, rules: s.destination === 'US' ? ['U1'] : [], description: 'Invoice date missing.' };
        },
      ];
      const r = rng.pick(options)();
      return { kind: this.kind, document: 'invoice', field: r.field, before: r.before, after: null, expectedRuleIds: r.rules, description: r.description };
    },
  },
];

export const ERROR_KINDS: ErrorKind[] = INJECTORS.map((i) => i.kind);

/** Returns a copy of the shipment with `count` errors of distinct kinds, plus a label for each. */
export function injectErrors(shipment: SyntheticShipment, rng: Rng, count: number, kinds: ErrorKind[] = ERROR_KINDS): { shipment: SyntheticShipment; labels: ErrorLabel[] } {
  const copy = structuredClone(shipment);
  const candidates = INJECTORS.filter((i) => kinds.includes(i.kind) && i.applies(copy));
  const chosen = rng.sample(candidates, count);
  const labels = chosen.map((i) => i.apply(copy, rng));
  // An error can hide another: with no consignee on the invoice there is nothing to compare the BL to.
  if (labels.some((l) => l.kind === 'missing_required_field' && l.field === 'consignee.name')) {
    for (const l of labels.filter((l) => l.kind === 'consignee_address_mismatch')) {
      l.expectedRuleIds = [];
      l.description += ' Not detectable: the invoice has no consignee to compare with.';
    }
  }
  return { shipment: copy, labels };
}
