import { fromFixed, toFixed } from '@doccheck/rules';
import type { CostAssumptions } from './penalties';

export interface CostShipment {
  shipmentId: string;
  reference?: string;
  destination: 'CA' | 'US';
  transportMode?: 'SEA' | 'AIR' | 'ROAD';
  containers: number;
  /** Shipped on board (B/L), YYYY-MM-DD; without it the shipment's creation is the start. */
  departure?: string;
  createdAt: string;
}

export interface CostFinding {
  shipmentId: string;
  ruleId: string;
  severity: string;
  /** When a later validation no longer had it (the document was corrected). */
  resolvedAt?: string;
  /** Accepted as a risk or marked a false positive: no cost is counted either way. */
  dismissed: boolean;
}

/** avoided: corrected before the estimated arrival; late: corrected after it; exposed: still open. */
export type Outcome = 'avoided' | 'late' | 'exposed';

export interface CostItem {
  shipmentId: string;
  reference?: string;
  /** A penalty id, or "delay". */
  item: string;
  label: string;
  ruleIds: string[];
  outcome: Outcome;
  amount: string;
  currency: string;
  arrival: string;
}

export interface Money {
  amount: string;
  currency: string;
}

export interface CostEstimate {
  items: CostItem[];
  /** Per outcome, one total per currency (no conversion between currencies). */
  totals: Record<Outcome, Money[]>;
}

const DAY = 86_400_000;
const date = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);

/** The shipment's estimated arrival: departure (or creation) plus the transit days of its mode. */
export function estimatedArrival(s: CostShipment, a: CostAssumptions): Date {
  const start = date(s.departure ?? s.createdAt);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) + a.transitDays[s.transportMode ?? 'SEA'] * DAY + DAY - 1);
}

const outcomeOf = (findings: CostFinding[], arrival: Date): Outcome | undefined => {
  const live = findings.filter((f) => !f.dismissed);
  if (live.length === 0) return undefined;
  if (live.some((f) => !f.resolvedAt)) return 'exposed';
  if (live.some((f) => date(f.resolvedAt!) > arrival)) return 'late';
  return 'avoided';
};

/**
 * What the findings of each shipment would have cost: every penalty whose rules found something,
 * once per shipment, and the hold (days × per-day cost × containers) when a finding is severe
 * enough to stop the goods. Each item counts as avoided, late or exposed by its findings' fate.
 */
export function estimateCost(shipments: readonly CostShipment[], findings: readonly CostFinding[], a: CostAssumptions): CostEstimate {
  const byShipment = new Map<string, CostFinding[]>();
  for (const f of findings) byShipment.set(f.shipmentId, [...(byShipment.get(f.shipmentId) ?? []), f]);
  const items: CostItem[] = [];
  for (const s of shipments) {
    const own = byShipment.get(s.shipmentId) ?? [];
    if (own.length === 0) continue;
    const arrival = estimatedArrival(s, a);
    const base = { shipmentId: s.shipmentId, ...(s.reference ? { reference: s.reference } : {}), arrival: arrival.toISOString().slice(0, 10) };
    for (const p of a.penalties) {
      if (p.destination !== s.destination) continue;
      const hit = own.filter((f) => p.ruleIds.includes(f.ruleId));
      const outcome = outcomeOf(hit, arrival);
      if (!outcome) continue;
      items.push({ ...base, item: p.id, label: p.label, ruleIds: [...new Set(hit.map((f) => f.ruleId))].sort(), outcome, amount: fromFixed(toFixed(p.amount)), currency: p.currency });
    }
    const severe = own.filter((f) => a.delay.severities.includes(f.severity as never));
    const outcome = a.delay.days > 0 ? outcomeOf(severe, arrival) : undefined;
    if (outcome) {
      const rate = a.delay.perDay[s.destination];
      const units = BigInt(Math.max(1, s.containers) * a.delay.days);
      items.push({ ...base, item: 'delay', label: `Hold: ${a.delay.days} day(s) × ${Math.max(1, s.containers)} container(s)`, ruleIds: [...new Set(severe.map((f) => f.ruleId))].sort(), outcome, amount: fromFixed(toFixed(rate.amount) * units), currency: rate.currency });
    }
  }
  const totals: Record<Outcome, Money[]> = { avoided: [], late: [], exposed: [] };
  for (const outcome of Object.keys(totals) as Outcome[]) {
    const sums = new Map<string, bigint>();
    for (const i of items.filter((x) => x.outcome === outcome)) sums.set(i.currency, (sums.get(i.currency) ?? 0n) + toFixed(i.amount));
    totals[outcome] = [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, v]) => ({ amount: fromFixed(v), currency }));
  }
  return { items, totals };
}
