import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { LinesQuery, ShipmentDataQuery, SummaryQuery } from './insights.dto';
import type { GoodsLine, InsightsSummary, Paged, ShipmentData, Total } from './insights.types';

/** The six-digit HS subheading of a line, or its heading when the code has only four digits. */
const HS = `coalesce(hs6, hs4)`;

/**
 * The user's shipments ($1, optionally of destination $2), the latest extracted invoice, packing list
 * and bill of lading of each (as validation picks them), the invoice lines, and per-shipment figures,
 * read from the tables the extractions are projected to (migration 013).
 * Weights and packages come from the bill of lading first, then the packing list, then the invoice.
 */
export const BASE = `
  with owned as (
    select id, reference, destination, created_at from shipments where user_id = $1 and ($2::text is null or destination = $2)
  ), latest as (
    select distinct on (d.shipment_id, d.detected_type) d.id as document_id
    from documents d join extractions e on e.document_id = d.id join owned o on o.id = d.shipment_id
    where d.status = 'EXTRACTED' and e.data is not null and d.detected_type in ('COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING')
    order by d.shipment_id, d.detected_type, d.created_at desc
  ), inv as (select i.* from invoices i join latest using (document_id)),
  pl as (select p.* from packing_lists p join latest using (document_id)),
  bl as (select b.* from bills_of_lading b join latest using (document_id)),
  lines as (
    select l.*, inv.invoice_number, inv.invoice_date, inv.seller_id, inv.seller_name, inv.buyer_id from invoice_lines l join inv using (document_id)
  ), per_ship as (
    select o.id, o.reference, o.destination, o.created_at,
      inv.invoice_number, to_char(inv.invoice_date, 'YYYY-MM-DD') as invoice_date, inv.incoterm, inv.incoterm_place,
      inv.invoice_total, inv.invoice_total_currency, coalesce(inv.line_count, 0) as line_count,
      coalesce(inv.seller_name, (select name from document_parties where document_id = bl.document_id and role = 'shipper' limit 1)) as seller,
      coalesce(inv.buyer_name, (select name from document_parties where document_id = bl.document_id and role = 'consignee' limit 1)) as buyer,
      pl.volume_m3, bl.bl_number, bl.carrier_name, bl.vessel, bl.voyage,
      coalesce(bl.port_of_loading_name, bl.port_of_loading_locode) as port_of_loading,
      coalesce(bl.port_of_discharge_name, bl.port_of_discharge_locode) as port_of_discharge,
      coalesce(bl.gross_kg, pl.gross_kg, inv.gross_kg) as gross_kg,
      coalesce(pl.net_kg, inv.net_kg) as net_kg,
      coalesce(bl.total_packages, pl.package_count, inv.package_count) as packages,
      coalesce(bl.container_count, 0) as container_count,
      array(select container_number from bl_containers c where c.document_id = bl.document_id and container_number is not null order by idx) as containers
    from owned o left join inv on inv.shipment_id = o.id left join pl on pl.shipment_id = o.id left join bl on bl.shipment_id = o.id
    where inv.shipment_id is not null or pl.shipment_id is not null or bl.shipment_id is not null
  )`;

const toTotals = (rows: { key: string; amount: string }[] | null): Total[] => (rows ?? []).map((r) => ({ key: r.key, amount: r.amount }));
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const money = (amount: string | null, currency: string | null) => (amount !== null && currency ? { amount, currency } : undefined);
const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

@Injectable()
export class InsightsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async summary(userId: string, { destination }: SummaryQuery): Promise<InsightsSummary> {
    const params = [userId, destination ?? null];
    const { rows: [r] } = await this.pool.query(
      `${BASE}
       select
         (select count(*)::int from per_ship) as shipments,
         (select count(*)::int from lines) as invoice_lines,
         (select coalesce(sum(gross_kg), 0)::text from per_ship) as gross_kg,
         (select coalesce(sum(net_kg), 0)::text from per_ship) as net_kg,
         (select coalesce(sum(packages), 0)::int from per_ship) as packages,
         (select coalesce(sum(container_count), 0)::int from per_ship) as containers,
         (select jsonb_agg(jsonb_build_object('key', key, 'amount', amount::text) order by amount desc) from (
            select line_total_currency as key, sum(line_total) as amount from lines group by 1
          ) t where key is not null and amount is not null) as value_by_currency,
         (select jsonb_agg(jsonb_build_object('key', key, 'amount', amount::text) order by amount desc) from (
            select quantity_unit as key, sum(quantity) as amount from lines group by 1
          ) t where key is not null and amount is not null) as quantity_by_unit`,
      params,
    );
    const groups = (column: string, extra = '') =>
      this.pool.query(
        `${BASE}, grouped as (
           select ${column} as k, line_total_currency as currency, count(*)::int as n, sum(line_total) as amount${extra}
           from lines group by 1, 2
         )
         select k, sum(n)::int as lines,
           coalesce(jsonb_agg(jsonb_build_object('key', currency, 'amount', amount::text) order by amount desc) filter (where currency is not null and amount is not null), '[]') as values
           ${extra ? ', min(description) as description' : ''}
         from grouped group by k order by lines desc, k limit 10`,
        params,
      );
    const [origins, hs] = await Promise.all([
      groups('country_of_origin'),
      groups(HS, `, mode() within group (order by description) as description`),
    ]);
    return {
      shipments: r.shipments,
      invoiceLines: r.invoice_lines,
      valueByCurrency: toTotals(r.value_by_currency),
      quantityByUnit: toTotals(r.quantity_by_unit),
      grossKg: r.gross_kg,
      netKg: r.net_kg,
      packages: r.packages,
      containers: r.containers,
      byOrigin: origins.rows.map((g) => ({ country: g.k, lines: g.lines, values: toTotals(g.values) })),
      byHsCode: hs.rows.map((g) => ({ hsCode: g.k, description: g.description ?? '', lines: g.lines, values: toTotals(g.values) })),
    };
  }

  /** Every invoice line, newest shipment first, in line order. */
  async lines(userId: string, q: LinesQuery): Promise<Paged<GoodsLine>> {
    const params: unknown[] = [userId, q.destination ?? null];
    const where: string[] = [];
    if (q.q) {
      params.push(like(q.q));
      const p = `$${params.length}`;
      where.push(`(lines.description ilike ${p} or lines.sku ilike ${p} or lines.invoice_number ilike ${p} or o.reference ilike ${p} or lines.seller_name ilike ${p})`);
    }
    if (q.origin) {
      params.push(q.origin);
      where.push(`lines.country_of_origin = $${params.length}`);
    }
    if (q.hs) {
      params.push(`${q.hs.replace(/\D/g, '')}%`);
      where.push(`lines.hs_digits like $${params.length}`);
    }
    const from = `from lines join owned o on o.id = lines.shipment_id${where.length ? ` where ${where.join(' and ')}` : ''}`;
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${BASE} select o.id, o.reference, o.destination, lines.*
         ${from} order by o.created_at desc, o.id, lines.line_no nulls last, lines.idx
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, q.limit, q.offset],
      ),
      this.pool.query(`${BASE} select count(*)::int as n ${from}`, params),
    ]);
    return {
      items: rows.map((r) => ({
        shipmentId: r.id,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.destination ? { destination: r.destination } : {}),
        documentId: r.document_id,
        invoiceNumber: text(r.invoice_number),
        seller: text(r.seller_name),
        lineNo: r.line_no ?? 0,
        sku: text(r.sku),
        description: text(r.description) ?? '',
        hsCode: text(r.hs_code),
        countryOfOrigin: text(r.country_of_origin),
        quantity: r.quantity !== null ? { value: r.quantity, unit: r.quantity_unit ?? '' } : undefined,
        unitPrice: money(r.unit_price, r.unit_price_currency),
        lineTotal: money(r.line_total, r.line_total_currency),
      })),
      total: count.n,
      limit: q.limit,
      offset: q.offset,
    };
  }

  /** Key figures of each shipment with extracted documents, newest first. */
  async shipments(userId: string, q: ShipmentDataQuery): Promise<Paged<ShipmentData>> {
    const params: unknown[] = [userId, q.destination ?? null];
    let where = '';
    if (q.q) {
      params.push(like(q.q));
      const p = `$${params.length}`;
      where = ` where (reference ilike ${p} or invoice_number ilike ${p} or seller ilike ${p} or buyer ilike ${p} or bl_number ilike ${p} or array_to_string(containers, ' ') ilike ${p})`;
    }
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${BASE} select *, gross_kg::text as gross, net_kg::text as net, volume_m3::text as volume from per_ship${where}
         order by created_at desc, id limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, q.limit, q.offset],
      ),
      this.pool.query(`${BASE} select count(*)::int as n from per_ship${where}`, params),
    ]);
    return {
      items: rows.map((r) => ({
        shipmentId: r.id,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.destination ? { destination: r.destination } : {}),
        createdAt: new Date(r.created_at).toISOString(),
        invoiceNumber: text(r.invoice_number),
        invoiceDate: text(r.invoice_date),
        seller: text(r.seller),
        buyer: text(r.buyer),
        incoterm: r.incoterm ? [r.incoterm, r.incoterm_place].filter(Boolean).join(' ') : undefined,
        invoiceTotal: money(r.invoice_total, r.invoice_total_currency),
        lines: r.line_count,
        packages: r.packages ?? undefined,
        grossKg: r.gross ?? undefined,
        netKg: r.net ?? undefined,
        volumeM3: r.volume ?? undefined,
        blNumber: text(r.bl_number),
        carrier: text(r.carrier_name),
        vessel: [r.vessel, r.voyage].filter((v) => typeof v === 'string' && v).join(' / ') || undefined,
        portOfLoading: text(r.port_of_loading),
        portOfDischarge: text(r.port_of_discharge),
        containers: r.containers ?? [],
      })),
      total: count.n,
      limit: q.limit,
      offset: q.offset,
    };
  }
}
