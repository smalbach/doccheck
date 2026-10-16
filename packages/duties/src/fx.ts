import type { Destination } from '@doccheck/schemas';
import { dec, div, type Fixed, fmtRate, mul } from './decimal';
import type { DutyTables } from './tables';

export interface ExchangeRate {
  from: string;
  to: string;
  /** Units of `to` per 1 unit of `from`, at full precision. */
  rate: Fixed;
  /** As published (e.g. "1.3712" CAD per USD, or "7.1320" CNY per USD). */
  published: string;
  direction: string;
  /** Business day the rate is for. */
  date: string;
  /** The day the rule asks for (date of direct shipment / exportation); differs when that day had no rate. */
  requestedDate: string;
  source: string;
  /** Entered by the user rather than read from a table. */
  manual?: boolean;
}

/** How many calendar days back a missing rate (weekend, holiday) may be looked for. */
const LOOKBACK_DAYS = 7;

const dayBefore = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The rate to convert `currency` into the destination's currency for `date`.
 *
 * CA: Bank of Canada rate for the date of direct shipment, or the last business day before it.
 * US: Federal Reserve H.10 noon buying rate for the date of exportation (19 CFR 159.32), or the
 * last business day before; CBP's certified rate for that date is the one that counts on the entry.
 */
export function exchangeRate(tables: DutyTables, destination: Destination, currency: string, date: string): ExchangeRate | undefined {
  const to = destination === 'CA' ? 'CAD' : 'USD';
  if (currency === to) return { from: currency, to, rate: dec(1), published: '1', direction: 'same currency', date, requestedDate: date, source: 'same currency' };
  let day = date;
  for (let i = 0; i <= LOOKBACK_DAYS; i++, day = dayBefore(day)) {
    if (destination === 'CA') {
      const row = tables.fxCa.rows.find(([d]) => d === day);
      const v = row?.[1][currency];
      if (v) return { from: currency, to, rate: dec(v), published: v, direction: `CAD per ${currency}`, date: day, requestedDate: date, source: tables.fxCa.meta.source };
    } else {
      const row = tables.fxUs.rows.find(([d]) => d === day);
      const v = row?.[1][currency];
      if (v?.usdPerUnit) return { from: currency, to, rate: dec(v.usdPerUnit), published: v.usdPerUnit, direction: `USD per ${currency}`, date: day, requestedDate: date, source: tables.fxUs.meta.source };
      if (v?.unitsPerUsd) return { from: currency, to, rate: div(dec(1), dec(v.unitsPerUsd)), published: v.unitsPerUsd, direction: `${currency} per USD`, date: day, requestedDate: date, source: tables.fxUs.meta.source };
    }
  }
  return undefined;
}

/** A rate the user entered: units of the destination currency per 1 unit of `currency`. */
export function manualRate(destination: Destination, currency: string, rate: string, date: string): ExchangeRate {
  const to = destination === 'CA' ? 'CAD' : 'USD';
  return { from: currency, to, rate: dec(rate), published: rate, direction: `${to} per ${currency}`, date, requestedDate: date, source: 'entered by the user', manual: true };
}

/** Converts at full precision (not rounded). */
export function convert(amount: Fixed, fx: ExchangeRate): Fixed {
  if (fx.direction.startsWith(`${fx.from} per `)) return div(amount, dec(fx.published));
  return mul(amount, fx.rate);
}

/** Display: "1 USD = 1.3712 CAD (Bank of Canada, 2026-03-20)". */
export const describeRate = (fx: ExchangeRate): string => `1 ${fx.from} = ${fmtRate(fx.rate)} ${fx.to} (${fx.source}, ${fx.date})`;
