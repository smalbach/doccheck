import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { LinesQuery, ShipmentDataQuery, SummaryQuery } from './insights.dto';
import type { GoodsLine, InsightsSummary, Paged, ShipmentData, Total } from './insights.types';

/** A decimal string from the extracted JSON as numeric, or null when it is not one (never a cast error). */
const num = (expr: string) => `(case when (${expr}) ~ '^-?[0-9]+(\\.[0-9]+)?$' then (${expr})::numeric end)`;

/** The six-digit HS subheading of a line, or null. */
const HS6 = `nullif(left(regexp_replace(coalesce(line->>'hsCode', ''), '[^0-9]', '', 'g'), 6), '')`;

/**
 * The user's shipments ($1, optionally of destination $2), the latest extracted invoice, packing list
 * and bill of lading of each (as validation picks them), the invoice lines, and per-shipment figures.
 * Weights and packages come from the bill of lading first, then the packing list, then the invoice.
 */
const BASE = `
  with owned as (
    select id, reference, destination, created_at from shipments where user_id = $1 and ($2::text is null or destination = $2)
  ), latest as (
    select distinct on (d.shipment_id, d.detected_type) d.shipment_id, d.detected_type, d.id as document_id, e.data
    from documents d join extractions e on e.document_id = d.id join owned o on o.id = d.shipment_id
    where d.status = 'EXTRACTED' and e.data is not null and d.detected_type in ('COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING')
    order by d.shipment_id, d.detected_type, d.created_at desc
  ), inv as (select * from latest where detected_type = 'COMMERCIAL_INVOICE'),
  pl as (select * from latest where detected_type = 'PACKING_LIST'),
  bl as (select * from latest where detected_type = 'BILL_OF_LADING'),
  lines as (
    select inv.shipment_id, inv.document_id, inv.data as invoice, l.value as line
    from inv cross join lateral jsonb_array_elements(case when jsonb_typeof(inv.data->'lines') = 'array' then inv.data->'lines' else '[]'::jsonb end) l
  ), per_ship as (
    select o.id, o.reference, o.destination, o.created_at, inv.data as invoice, pl.data as packing, bl.data as bol,
      coalesce(${num("bl.data->'totalGrossWeight'->>'kg'")}, ${num("pl.data->'totals'->'grossWeight'->>'kg'")}, ${num("inv.data->'grossWeight'->>'kg'")}) as gross_kg,
      coalesce(${num("pl.data->'totals'->'netWeight'->>'kg'")}, ${num("inv.data->'netWeight'->>'kg'")}) as net_kg,
      coalesce(${num("bl.data->>'totalPackages'")}, ${num("pl.data->'totals'->>'packageCount'")}, ${num("inv.data->>'packageCount'")})::int as packages,
      case when jsonb_typeof(bl.data->'containers') = 'array' then bl.data->'containers' else '[]'::jsonb end as containers,
      (select count(*)::int from lines where lines.shipment_id = o.id) as line_count
    from owned o left join inv on inv.shipment_id = o.id left join pl on pl.shipment_id = o.id left join bl on bl.shipment_id = o.id
    where inv.shipment_id is not null or pl.shipment_id is not null or bl.shipment_id is not null
  )`;

const toTotals = (rows: { key: string; amount: string }[] | null): Total[] => (rows ?? []).map((r) => ({ key: r.key, amount: r.amount }));
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const money = (m: unknown) => {
  const v = m as { amount?: unknown; currency?: unknown } | null;
  return v && typeof v.amount === 'string' && typeof v.currency === 'string' ? { amount: v.amount, currency: v.currency } : undefined;
};
const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const place = (v: unknown) => {
  const loc = v as { name?: string; unLocode?: string } | null;
  return loc?.name ?? loc?.unLocode ?? undefined;
};

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
         (select coalesce(sum(jsonb_array_length(containers)), 0)::int from per_ship) as containers,
         (select jsonb_agg(jsonb_build_object('key', key, 'amount', amount::text) order by amount desc) from (
            select line->'lineTotal'->>'currency' as key, sum(${num("line->'lineTotal'->>'amount'")}) as amount from lines group by 1
          ) t where key is not null and amount is not null) as value_by_currency,
         (select jsonb_agg(jsonb_build_object('key', key, 'amount', amount::text) order by amount desc) from (
            select line->'quantity'->>'unit' as key, sum(${num("line->'quantity'->>'value'")}) as amount from lines group by 1
          ) t where key is not null and amount is not null) as quantity_by_unit`,
      params,
    );
    const groups = (column: string, extra = '') =>
      this.pool.query(
        `${BASE}, grouped as (
           select ${column} as k, line->'lineTotal'->>'currency' as currency, count(*)::int as n,
             sum(${num("line->'lineTotal'->>'amount'")}) as amount${extra}
           from lines group by 1, 2
         )
         select k, sum(n)::int as lines,
           coalesce(jsonb_agg(jsonb_build_object('key', currency, 'amount', amount::text) order by amount desc) filter (where currency is not null and amount is not null), '[]') as values
           ${extra ? ', min(description) as description' : ''}
         from grouped group by k order by lines desc, k limit 10`,
        params,
      );
    const [origins, hs] = await Promise.all([
      groups(`line->>'countryOfOrigin'`),
      groups(HS6, `, mode() within group (order by line->>'description') as description`),
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
      where.push(`(line->>'description' ilike ${p} or line->>'sku' ilike ${p} or invoice->>'invoiceNumber' ilike ${p} or o.reference ilike ${p} or invoice->'seller'->>'name' ilike ${p})`);
    }
    if (q.origin) {
      params.push(q.origin);
      where.push(`line->>'countryOfOrigin' = $${params.length}`);
    }
    if (q.hs) {
      params.push(`${q.hs.replace(/\D/g, '')}%`);
      where.push(`regexp_replace(coalesce(line->>'hsCode', ''), '[^0-9]', '', 'g') like $${params.length}`);
    }
    const from = `from lines join owned o on o.id = lines.shipment_id${where.length ? ` where ${where.join(' and ')}` : ''}`;
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${BASE} select o.id, o.reference, o.destination, lines.document_id, invoice->>'invoiceNumber' as invoice_number, invoice->'seller'->>'name' as seller, line
         ${from} order by o.created_at desc, o.id, ${num("line->>'lineNo'")} nulls last
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, q.limit, q.offset],
      ),
      this.pool.query(`${BASE} select count(*)::int as n ${from}`, params),
    ]);
    return {
      items: rows.map((r) => {
        const line = r.line ?? {};
        const quantity = line.quantity && typeof line.quantity.value === 'string' ? { value: line.quantity.value, unit: String(line.quantity.unit ?? '') } : undefined;
        return {
          shipmentId: r.id,
          ...(r.reference ? { reference: r.reference } : {}),
          ...(r.destination ? { destination: r.destination } : {}),
          documentId: r.document_id,
          invoiceNumber: text(r.invoice_number),
          seller: text(r.seller),
          lineNo: typeof line.lineNo === 'number' ? line.lineNo : 0,
          sku: text(line.sku),
          description: text(line.description) ?? '',
          hsCode: text(line.hsCode),
          countryOfOrigin: text(line.countryOfOrigin),
          quantity,
          unitPrice: money(line.unitPrice),
          lineTotal: money(line.lineTotal),
        };
      }),
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
      where = ` where (reference ilike ${p} or invoice->>'invoiceNumber' ilike ${p} or invoice->'seller'->>'name' ilike ${p} or invoice->'buyer'->>'name' ilike ${p} or bol->>'blNumber' ilike ${p} or containers::text ilike ${p})`;
    }
    const [{ rows }, { rows: [count] }] = await Promise.all([
      this.pool.query(
        `${BASE} select *, gross_kg::text as gross, net_kg::text as net from per_ship${where}
         order by created_at desc, id limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, q.limit, q.offset],
      ),
      this.pool.query(`${BASE} select count(*)::int as n from per_ship${where}`, params),
    ]);
    return {
      items: rows.map((r) => {
        const inv = r.invoice ?? {};
        const bol = r.bol ?? {};
        const incoterm = inv.incoterm?.code ? [inv.incoterm.code, inv.incoterm.place].filter(Boolean).join(' ') : undefined;
        return {
          shipmentId: r.id,
          ...(r.reference ? { reference: r.reference } : {}),
          ...(r.destination ? { destination: r.destination } : {}),
          createdAt: new Date(r.created_at).toISOString(),
          invoiceNumber: text(inv.invoiceNumber),
          invoiceDate: text(inv.invoiceDate),
          seller: text(inv.seller?.name) ?? text(bol.shipper?.name),
          buyer: text(inv.buyer?.name) ?? text(bol.consignee?.name),
          incoterm,
          invoiceTotal: money(inv.invoiceTotal),
          lines: r.line_count,
          packages: r.packages ?? undefined,
          grossKg: r.gross ?? undefined,
          netKg: r.net ?? undefined,
          volumeM3: text(r.packing?.totals?.volumeM3) ?? undefined,
          blNumber: text(bol.blNumber),
          carrier: text(bol.carrier?.name),
          vessel: [bol.vessel, bol.voyage].filter((v) => typeof v === 'string' && v).join(' / ') || undefined,
          portOfLoading: place(bol.portOfLoading),
          portOfDischarge: place(bol.portOfDischarge),
          containers: (r.containers as { number?: unknown }[]).map((c) => c?.number).filter((n): n is string => typeof n === 'string'),
        };
      }),
      total: count.n,
      limit: q.limit,
      offset: q.offset,
    };
  }
}
