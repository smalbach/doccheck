import type { ExtractableType } from './extract';

/**
 * Field-level scoring of an extraction against ground truth. Only fields that the templates print
 * are scored; a field missing from the truth (e.g. removed by an injected error) must come back null.
 */

type Kind = 'text' | 'decimal' | 'weight' | 'code';

export const SCORED_FIELDS: Record<ExtractableType, [path: string, kind: Kind][]> = {
  COMMERCIAL_INVOICE: [
    ['invoiceNumber', 'code'], ['invoiceDate', 'code'], ['poNumber', 'code'], ['shipmentDate', 'code'],
    ['seller.name', 'text'], ['buyer.name', 'text'], ['consignee.name', 'text'], ['portOfEntry.name', 'text'],
    ['currency', 'code'], ['incoterm.code', 'code'], ['packageCount', 'decimal'],
    ['grossWeight.kg', 'weight'], ['netWeight.kg', 'weight'],
    ['invoiceTotal.amount', 'decimal'], ['invoiceTotal.currency', 'code'],
    ['charges.freight.amount', 'decimal'], ['charges.freight.currency', 'code'],
    ['lines[*].description', 'text'], ['lines[*].quantity.value', 'decimal'], ['lines[*].quantity.unit', 'code'],
    ['lines[*].unitPrice.amount', 'decimal'], ['lines[*].unitPrice.currency', 'code'],
    ['lines[*].lineTotal.amount', 'decimal'], ['lines[*].lineTotal.currency', 'code'],
    ['lines[*].countryOfOrigin', 'code'], ['lines[*].hsCode', 'code'],
  ],
  PACKING_LIST: [
    ['packingListNumber', 'code'], ['invoiceRef', 'code'], ['seller.name', 'text'], ['consignee.name', 'text'],
    ['totals.packageCount', 'decimal'], ['totals.netWeight.kg', 'weight'], ['totals.grossWeight.kg', 'weight'],
    ['packages[*].range', 'code'], ['packages[*].count', 'decimal'], ['packages[*].type', 'code'],
    ['packages[*].contents[0].quantity.value', 'decimal'], ['packages[*].netWeight.kg', 'weight'], ['packages[*].grossWeight.kg', 'weight'],
  ],
  BILL_OF_LADING: [
    ['blNumber', 'code'], ['bookingNumber', 'code'], ['carrier.scac', 'code'],
    ['shipper.name', 'text'], ['consignee.name', 'text'], ['consignee.address.lines[0]', 'text'], ['notifyParty.name', 'text'],
    ['vessel', 'text'], ['voyage', 'code'], ['portOfLoading.name', 'text'], ['portOfDischarge.name', 'text'], ['placeOfDelivery.name', 'text'],
    ['totalPackages', 'decimal'], ['totalGrossWeight.kg', 'weight'], ['totalGrossWeight.raw.unit', 'code'], ['shippedOnBoardDate', 'code'],
    ['containers[*].number', 'code'], ['containers[*].seal', 'code'], ['containers[*].packages', 'decimal'], ['containers[*].grossWeight.kg', 'weight'],
  ],
  ISF: [
    ['importerOfRecordNumber', 'code'], ['consigneeNumber', 'code'],
    ['seller.name', 'text'], ['seller.address.country', 'code'], ['buyer.name', 'text'], ['manufacturer.name', 'text'], ['manufacturer.address.city', 'text'],
    ['shipToParty.name', 'text'], ['shipToParty.address.postalCode', 'code'], ['consolidator.name', 'text'],
    ['countryOfOrigin', 'code'], ['htsCode', 'code'], ['containerStuffingLocation.city', 'text'], ['containerStuffingLocation.country', 'code'],
  ],
};

export type Outcome = 'correct' | 'wrong' | 'missing' | 'spurious';

export interface FieldScore {
  /** Field path with indexes resolved: "lines[1].quantity.value". */
  field: string;
  /** Path with [*]: "lines[*].quantity.value". Used to aggregate. */
  pattern: string;
  outcome: Outcome;
  expected: unknown;
  got: unknown;
}

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    const m = part.match(/^(\w+)\[(\d+)\]$/);
    cur = m ? (cur as Record<string, unknown[]>)[m[1]]?.[Number(m[2])] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** "lines[*].x" -> ["lines[0].x", "lines[1].x", ...] for the longer of the two arrays. */
function expand(pattern: string, a: unknown, b: unknown): string[] {
  const star = pattern.indexOf('[*]');
  if (star < 0) return [pattern];
  const arrayPath = pattern.slice(0, star);
  const n = Math.max((get(a, arrayPath) as unknown[] | undefined)?.length ?? 0, (get(b, arrayPath) as unknown[] | undefined)?.length ?? 0);
  return Array.from({ length: n }, (_, i) => pattern.replace('[*]', `[${i}]`));
}

const canonText = (v: unknown) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function same(kind: Kind, expected: unknown, got: unknown): boolean {
  switch (kind) {
    case 'decimal':
      return Number(expected) === Number(got);
    case 'weight': {
      // Pounds converted back to kilograms are off by up to half a printed pound.
      const e = Number(expected);
      const g = Number(got);
      return Math.abs(e - g) <= Math.max(0.5, e * 0.0005);
    }
    case 'code':
      return String(expected).toUpperCase().replace(/\s+/g, '') === String(got).toUpperCase().replace(/\s+/g, '');
    default:
      return canonText(expected) === canonText(got);
  }
}

export function scoreDocument(type: ExtractableType, truth: unknown, extracted: unknown): FieldScore[] {
  const scores: FieldScore[] = [];
  for (const [pattern, kind] of SCORED_FIELDS[type]) {
    for (const field of expand(pattern, truth, extracted)) {
      const expected = get(truth, field);
      const got = extracted ? get(extracted, field) : undefined;
      const hasE = expected !== undefined && expected !== null && expected !== '';
      const hasG = got !== undefined && got !== null && got !== '';
      if (!hasE && !hasG) continue;
      const outcome: Outcome = !hasG ? 'missing' : !hasE ? 'spurious' : same(kind, expected, got) ? 'correct' : 'wrong';
      scores.push({ field, pattern, outcome, expected, got });
    }
  }
  return scores;
}

export interface Tally {
  total: number;
  correct: number;
  wrong: number;
  missing: number;
  spurious: number;
  accuracy: number;
}

export function tally(scores: FieldScore[]): Tally {
  const t = { total: scores.length, correct: 0, wrong: 0, missing: 0, spurious: 0, accuracy: 0 };
  for (const s of scores) t[s.outcome]++;
  t.accuracy = t.total ? Math.round((t.correct / t.total) * 10000) / 10000 : 1;
  return t;
}
