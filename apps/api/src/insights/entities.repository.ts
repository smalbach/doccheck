import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { EntityQuery, PartiesQuery, PartyRole, ProductsQuery } from './insights.dto';
import { BASE, like } from './insights.repository';
import type { Paged, PartyDetail, PartySummary, PricePoint, ProductDetail, ProductSummary, Total } from './insights.types';

export const ROLES: Record<PartyRole, string[]> = {
  supplier: ['seller', 'shipper', 'exporter', 'manufacturer', 'originator'],
  customer: ['buyer', 'consignee', 'notify', 'ship_to'],
};

/** Where each party appears on the shipments in BASE: the documents validation uses, and the ISF. */
const APPEAR = `, appear as (
    select dp.party_id, dp.shipment_id, dp.role, dp.name from document_parties dp join owned o on o.id = dp.shipment_id
    where dp.party_id is not null and (dp.source = 'ISF' or dp.document_id in (select document_id from latest))
  )`;

/** Sums of `amount` per `key` over the rows of `from` (a FROM ... WHERE clause), as a Total[] jsonb. */
const totals = (key: string, amount: string, from: string) =>
  `(select coalesce(jsonb_agg(jsonb_build_object('key', k, 'amount', a::text) order by a desc), '[]') from (
     select ${key} as k, sum(${amount}) as a ${from} and ${key} is not null and ${amount} is not null group by 1
   ) t)`;

const date = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
const opt = <T>(v: T | null | undefined) => v ?? undefined;
const money = (amount: string | null, currency: string | null) => (amount !== null && currency ? { amount, currency } : undefined);

/** The user's companies and products across shipments, from the tables of migration 013. */
@Injectable()
export class EntitiesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async parties(userId: string, q: PartiesQuery): Promise<Paged<PartySummary>> {
    const { items, total } = await this.findParties(userId, q, q);
    return { items, total, limit: q.limit, offset: q.offset };
  }

  async party(userId: string, id: string, { destination }: EntityQuery): Promise<PartyDetail | null> {
    const { items: [summary] } = await this.findParties(userId, { destination, id }, { limit: 1, offset: 0 });
    if (!summary) return null;
    const params = [userId, destination ?? null, id];
    const mine = `from lines x where x.product_id = pr.id and $3 in (x.seller_id, x.buyer_id)`;
    const [products, shipments] = await Promise.all([
      this.pool.query(
        `${BASE}
         select pr.id, pr.sku, pr.description, g.n as lines, ${totals('quantity_unit', 'quantity', mine)} as quantities, ${totals('line_total_currency', 'line_total', mine)} as values
         from (select product_id, count(*)::int as n from lines where $3 in (seller_id, buyer_id) and product_id is not null group by 1) g
         join products pr on pr.id = g.product_id order by g.n desc, lower(pr.description) limit 20`,
        params,
      ),
      this.pool.query(
        `${BASE}${APPEAR}
         select o.id, o.reference, o.destination, o.created_at, inv.invoice_number, ${date('inv.invoice_date')} as invoice_date, inv.invoice_total, inv.invoice_total_currency,
           array(select distinct role from appear a where a.party_id = $3 and a.shipment_id = o.id order by 1) as roles
         from owned o left join inv on inv.shipment_id = o.id
         where o.id in (select shipment_id from appear where party_id = $3) order by o.created_at desc limit 50`,
        params,
      ),
    ]);
    return {
      ...summary,
      topProducts: products.rows.map((r) => ({ id: r.id, sku: opt(r.sku), description: r.description, lines: r.lines, quantities: r.quantities, values: r.values })),
      recentShipments: shipments.rows.map((r) => ({
        shipmentId: r.id,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.destination ? { destination: r.destination } : {}),
        createdAt: new Date(r.created_at).toISOString(),
        roles: r.roles,
        invoiceNumber: opt(r.invoice_number),
        invoiceDate: opt(r.invoice_date),
        invoiceTotal: money(r.invoice_total, r.invoice_total_currency),
      })),
    };
  }

  async products(userId: string, q: ProductsQuery): Promise<Paged<ProductSummary>> {
    const { items, total } = await this.findProducts(userId, q, q);
    return { items, total, limit: q.limit, offset: q.offset };
  }

  async product(userId: string, id: string, { destination }: EntityQuery): Promise<ProductDetail | null> {
    const { items: [summary] } = await this.findProducts(userId, { destination, id }, { limit: 1, offset: 0 });
    if (!summary) return null;
    const { rows } = await this.pool.query(
      `${BASE}
       select b.shipment_id, o.reference, b.document_id, b.invoice_number, ${date('b.invoice_date')} as invoice_date, b.seller_id, b.seller_name,
         b.quantity, b.quantity_unit, b.unit_price, b.unit_price_currency, b.line_total, b.line_total_currency
       from lines b join owned o on o.id = b.shipment_id where b.product_id = $3
       order by b.invoice_date nulls first, o.created_at, b.idx limit 500`,
      [userId, destination ?? null, id],
    );
    const history: PricePoint[] = rows.map((r) => ({
      shipmentId: r.shipment_id,
      ...(r.reference ? { reference: r.reference } : {}),
      documentId: r.document_id,
      invoiceNumber: opt(r.invoice_number),
      invoiceDate: opt(r.invoice_date),
      sellerId: opt(r.seller_id),
      seller: opt(r.seller_name),
      quantity: r.quantity !== null ? { value: r.quantity, unit: r.quantity_unit ?? '' } : undefined,
      unitPrice: money(r.unit_price, r.unit_price_currency),
      lineTotal: money(r.line_total, r.line_total_currency),
    }));
    return { ...summary, history };
  }

  private async findParties(
    userId: string,
    f: { destination?: string; q?: string; role?: PartyRole; id?: string },
    page: { limit: number; offset: number },
  ): Promise<{ items: PartySummary[]; total: number }> {
    const params: unknown[] = [userId, f.destination ?? null];
    const where: string[] = [];
    if (f.id) {
      params.push(f.id);
      where.push(`p.id = $${params.length}`);
    }
    if (f.role) {
      params.push(ROLES[f.role]);
      where.push(`exists (select 1 from appear a where a.party_id = p.id and a.role = any($${params.length}))`);
    }
    if (f.q) {
      params.push(like(f.q));
      const n = `$${params.length}`;
      where.push(`(p.name ilike ${n} or p.tax_id ilike ${n} or exists (select 1 from appear a where a.party_id = p.id and a.name ilike ${n}))`);
    }
    const picked = `${BASE}${APPEAR}, picked as (
      select p.* from parties p where p.id in (select party_id from appear)${where.map((w) => ` and ${w}`).join('')}
    )`;
    const theirs = `from lines where p.id in (lines.seller_id, lines.buyer_id)`;
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${picked}
         select * from (
           select p.id, p.name, p.country, p.tax_id,
             array(select distinct role from appear a where a.party_id = p.id order by 1) as roles,
             array(select distinct name from appear a where a.party_id = p.id order by 1) as names,
             (select count(distinct shipment_id)::int from appear a where a.party_id = p.id) as shipments,
             (select count(*)::int from inv where p.id in (inv.seller_id, inv.buyer_id)) as invoices,
             (select count(*)::int ${theirs}) as lines,
             ${totals('line_total_currency', 'line_total', theirs)} as values,
             (select count(distinct product_id)::int ${theirs}) as products,
             (select ${date('min(invoice_date)')} from inv where p.id in (inv.seller_id, inv.buyer_id)) as first_date,
             (select ${date('max(invoice_date)')} from inv where p.id in (inv.seller_id, inv.buyer_id)) as last_date
           from picked p
         ) x order by shipments desc, lower(name), id limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, page.limit, page.offset],
      ),
      this.pool.query(`${picked} select count(*)::int as n from picked`, params),
    ]);
    return {
      total: count.n,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        country: opt(r.country),
        taxId: opt(r.tax_id),
        roles: r.roles,
        names: r.names,
        shipments: r.shipments,
        invoices: r.invoices,
        lines: r.lines,
        values: r.values as Total[],
        products: r.products,
        firstDate: opt(r.first_date),
        lastDate: opt(r.last_date),
      })),
    };
  }

  private async findProducts(
    userId: string,
    f: { destination?: string; q?: string; origin?: string; hs?: string; id?: string },
    page: { limit: number; offset: number },
  ): Promise<{ items: ProductSummary[]; total: number }> {
    const params: unknown[] = [userId, f.destination ?? null];
    const lineWhere: string[] = [];
    const productWhere: string[] = [];
    if (f.id) {
      params.push(f.id);
      lineWhere.push(`product_id = $${params.length}`);
    }
    if (f.origin) {
      params.push(f.origin);
      lineWhere.push(`country_of_origin = $${params.length}`);
    }
    if (f.hs) {
      params.push(`${f.hs.replace(/\D/g, '')}%`);
      lineWhere.push(`hs_digits like $${params.length}`);
    }
    if (f.q) {
      params.push(like(f.q));
      const n = `$${params.length}`;
      productWhere.push(`(pr.description ilike ${n} or pr.sku ilike ${n} or pr.hs_code ilike ${n})`);
    }
    const picked = `${BASE}, bought as (
      select * from lines where product_id is not null${lineWhere.map((w) => ` and ${w}`).join('')}
    ), agg as (
      select product_id, count(*)::int as n, count(distinct shipment_id)::int as ships, count(distinct seller_id)::int as sellers,
        ${date('max(invoice_date)')} as last_date
      from bought group by 1
    ), picked as (
      select pr.*, agg.n, agg.ships, agg.sellers, agg.last_date from products pr join agg on agg.product_id = pr.id
      ${productWhere.length ? `where ${productWhere.join(' and ')}` : ''}
    )`;
    const its = `from bought b where b.product_id = p.id`;
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${picked}
         select p.id, p.sku, p.description, p.hs_code, p.country_of_origin, p.unit, p.n, p.ships, p.sellers, p.last_date,
           (select seller_name ${its} order by invoice_date desc nulls last limit 1) as last_seller,
           ${totals('quantity_unit', 'quantity', its)} as quantities,
           ${totals('line_total_currency', 'line_total', its)} as values,
           (select coalesce(jsonb_agg(jsonb_build_object('currency', c, 'min', mn::text, 'max', mx::text, 'avg', av::text, 'last', lst::text) order by n desc), '[]') from (
              select unit_price_currency as c, count(*) as n, min(unit_price) as mn, max(unit_price) as mx,
                trim_scale(round(coalesce(sum(quantity * unit_price) / nullif(sum(quantity) filter (where quantity is not null), 0), avg(unit_price)), 4)) as av,
                (array_agg(unit_price order by invoice_date desc nulls last))[1] as lst
              ${its} and unit_price is not null and unit_price_currency is not null group by 1
            ) t) as prices
         from picked p order by p.n desc, lower(p.description), p.id limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, page.limit, page.offset],
      ),
      this.pool.query(`${picked} select count(*)::int as n from picked`, params),
    ]);
    return {
      total: count.n,
      items: rows.map((r) => ({
        id: r.id,
        sku: opt(r.sku),
        description: r.description,
        hsCode: opt(r.hs_code),
        countryOfOrigin: opt(r.country_of_origin),
        unit: opt(r.unit),
        lines: r.n,
        shipments: r.ships,
        sellers: r.sellers,
        lastSeller: opt(r.last_seller),
        lastDate: opt(r.last_date),
        quantities: r.quantities,
        values: r.values,
        prices: r.prices,
      })),
    };
  }
}
