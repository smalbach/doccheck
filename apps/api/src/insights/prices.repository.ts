import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { PriceGroupQuery, PricesQuery } from './analytics.dto';
import type { PriceGroup, PriceGroupDetail, PricePointRow } from './analytics.types';
import { BASE } from './insights.repository';
import { isOutlier, priceStats } from './price-stats';

/** Most invoice lines read for the benchmark; an organization with more sees its newest ones. */
const MAX_LINES = 20_000;

interface LineRow {
  shipment_id: string;
  reference: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  description: string | null;
  quantity: string | null;
  unit_price: string;
  currency: string;
  unit: string;
  product_id: string | null;
  product: string | null;
  hs6: string | null;
  origin: string | null;
}

/**
 * Unit prices across the organization's history (the current invoice of each shipment, as the product
 * pages read them), grouped per product or per HS-6 subheading and origin, in one currency and
 * unit: prices in different currencies or units are never compared.
 */
@Injectable()
export class PricesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async lines(orgId: string, destination?: string): Promise<LineRow[]> {
    const { rows } = await this.pool.query<LineRow>(
      `${BASE}
       select l.shipment_id, o.reference, l.invoice_number, to_char(l.invoice_date, 'YYYY-MM-DD') as invoice_date, l.seller_name, l.description,
         l.quantity::text as quantity, l.unit_price::text as unit_price, l.unit_price_currency as currency, coalesce(l.quantity_unit, '') as unit,
         l.product_id, p.description as product, coalesce(l.hs6, p.hs6) as hs6, coalesce(l.country_of_origin, p.country_of_origin) as origin
       from lines l join owned o on o.id = l.shipment_id left join products p on p.id = l.product_id
       where l.unit_price is not null and l.unit_price_currency is not null
       order by o.created_at desc, l.idx limit ${MAX_LINES}`,
      [orgId, destination ?? null],
    );
    return rows;
  }

  private static keyOf(by: 'product' | 'hs6', l: LineRow): { key: string; label: string; hs6?: string; origin?: string } | undefined {
    if (by === 'product') return l.product_id ? { key: l.product_id, label: l.product ?? l.description ?? '', ...(l.hs6 ? { hs6: l.hs6 } : {}), ...(l.origin ? { origin: l.origin } : {}) } : undefined;
    return l.hs6 ? { key: `${l.hs6}:${l.origin ?? ''}`, label: l.hs6, hs6: l.hs6, ...(l.origin ? { origin: l.origin } : {}) } : undefined;
  }

  private group(by: 'product' | 'hs6', rows: LineRow[]) {
    const groups = new Map<string, { head: NonNullable<ReturnType<typeof PricesRepository.keyOf>>; currency: string; unit: string; rows: LineRow[] }>();
    for (const l of rows) {
      const head = PricesRepository.keyOf(by, l);
      if (!head) continue;
      const id = `${head.key}|${l.currency}|${l.unit}`;
      const g = groups.get(id) ?? { head, currency: l.currency, unit: l.unit, rows: [] };
      g.rows.push(l);
      groups.set(id, g);
    }
    return [...groups.values()];
  }

  async groups(orgId: string, q: PricesQuery): Promise<PriceGroup[]> {
    const needle = q.q?.toLowerCase();
    const out: PriceGroup[] = [];
    for (const g of this.group(q.by, await this.lines(orgId, q.destination))) {
      const stats = priceStats(g.rows.map((r) => r.unit_price))!;
      const outliers = g.rows.filter((r) => isOutlier(r.unit_price, stats)).length;
      if (q.outliers === 'true' && outliers === 0) continue;
      if (needle && ![g.head.label, g.head.hs6, g.head.origin, ...g.rows.map((r) => r.description)].some((t) => t?.toLowerCase().includes(needle))) continue;
      out.push({ ...g.head, currency: g.currency, unit: g.unit, stats, outliers });
    }
    return out.sort((a, b) => b.outliers - a.outliers || b.stats.n - a.stats.n || a.label.localeCompare(b.label)).slice(0, 200);
  }

  async group1(orgId: string, q: PriceGroupQuery): Promise<PriceGroupDetail | null> {
    const g = this.group(q.by, await this.lines(orgId, q.destination)).find((x) => x.head.key === q.key && x.currency === q.currency && x.unit === q.unit);
    if (!g) return null;
    const stats = priceStats(g.rows.map((r) => r.unit_price))!;
    const points: PricePointRow[] = g.rows
      .map((r) => ({
        shipmentId: r.shipment_id,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.invoice_number ? { invoiceNumber: r.invoice_number } : {}),
        ...(r.invoice_date ? { invoiceDate: r.invoice_date } : {}),
        ...(r.seller_name ? { seller: r.seller_name } : {}),
        description: r.description ?? '',
        ...(r.quantity ? { quantity: r.quantity } : {}),
        unitPrice: r.unit_price,
        outlier: isOutlier(r.unit_price, stats),
      }))
      .sort((a, b) => (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? ''));
    return { ...g.head, currency: g.currency, unit: g.unit, stats, outliers: points.filter((p) => p.outlier).length, points };
  }
}
