import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PriorInvoice, PurchaseOrder, RuleConfig } from '@doccheck/rules';
import { PG_POOL } from '../db/db.module';
import { poKey, type PurchaseOrderInput } from './purchase-orders';

export interface StoredRuleConfig {
  config: RuleConfig;
  updatedAt?: string;
  updatedBy?: string;
}

/** A past invoice line with its price, for rule X23. */
export interface PriceRow {
  documentId: string;
  idx: number;
  shipmentId: string;
  sku?: string;
  description?: string;
  unitPrice: string;
  currency: string;
  unit?: string;
  invoiceNumber?: string;
  date?: string;
}

export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  sellerName?: string;
  currency?: string;
  orderDate?: string;
  lines: number;
  source?: string;
  updatedAt: string;
}

/** Most past prices loaded per validation (newest first): plenty for a median, bounded for a big account. */
const MAX_PRICE_ROWS = 5000;
const opt = <T>(v: T | null | undefined) => (v === null || v === undefined ? undefined : v);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === 'string' ? d.slice(0, 10) : undefined);

@Injectable()
export class RuleSettingsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async get(orgId: string): Promise<StoredRuleConfig | null> {
    const { rows } = await this.pool.query('select r.config, r.updated_at, u.email from rule_settings r left join users u on u.id = r.updated_by where r.org_id = $1', [orgId]);
    if (!rows[0]) return null;
    return { config: rows[0].config, updatedAt: new Date(rows[0].updated_at).toISOString(), ...(rows[0].email ? { updatedBy: rows[0].email } : {}) };
  }

  async save(orgId: string, config: RuleConfig, userId: string): Promise<void> {
    await this.pool.query(
      `insert into rule_settings (org_id, config, updated_by) values ($1, $2, $3)
       on conflict (org_id) do update set config = excluded.config, updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, JSON.stringify(config), userId],
    );
  }

  async remove(orgId: string): Promise<void> {
    await this.pool.query('delete from rule_settings where org_id = $1', [orgId]);
  }

  /** The organization the shipment belongs to (null for rows from before accounts existed). */
  async shipmentOrg(shipmentId: string): Promise<string | null> {
    const { rows } = await this.pool.query('select org_id from shipments where id = $1', [shipmentId]);
    return rows[0]?.org_id ?? null;
  }

  /** Invoices of the organization's other shipments with the same number (letters and digits, any case). */
  async invoicesNumbered(orgId: string, shipmentId: string, invoiceNumber: string): Promise<PriorInvoice[]> {
    const key = invoiceNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!key) return [];
    const { rows } = await this.pool.query(
      `select i.document_id, i.shipment_id, s.reference, i.invoice_number, i.seller_name, i.invoice_date
       from invoices i join shipments s on s.id = i.shipment_id
       where i.org_id = $1 and i.shipment_id <> $2 and upper(regexp_replace(coalesce(i.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = $3
       order by i.invoice_date desc nulls last limit 50`,
      [orgId, shipmentId, key],
    );
    return rows.map((r) => ({
      shipmentId: r.shipment_id,
      ...(r.reference ? { shipmentReference: r.reference } : {}),
      documentId: r.document_id,
      invoiceNumber: r.invoice_number,
      ...(r.seller_name ? { sellerName: r.seller_name } : {}),
      ...(iso(r.invoice_date) ? { invoiceDate: iso(r.invoice_date) } : {}),
    }));
  }

  /** Past unit prices of the given SKUs or descriptions in the organization's other shipments, newest first. */
  async pastPrices(orgId: string, shipmentId: string, skus: string[], descriptions: string[]): Promise<PriceRow[]> {
    if (!skus.length && !descriptions.length) return [];
    const { rows } = await this.pool.query(
      `select l.document_id, l.idx, l.shipment_id, l.sku, l.description, l.unit_price::text as unit_price, l.unit_price_currency, l.quantity_unit,
              i.invoice_number, coalesce(i.invoice_date, i.shipment_date) as date
       from invoice_lines l join invoices i on i.document_id = l.document_id
       where l.org_id = $1 and l.shipment_id <> $2 and l.unit_price is not null and l.unit_price_currency is not null
         and (upper(trim(l.sku)) = any($3::text[])
              or (dc_text(l.sku) is null and dc_norm(l.description) = any(select dc_norm(d) from unnest($4::text[]) d)))
       order by date desc nulls last limit ${MAX_PRICE_ROWS}`,
      [orgId, shipmentId, skus.map((s) => s.trim().toUpperCase()), descriptions],
    );
    return rows.map((r) => ({
      documentId: r.document_id,
      idx: r.idx,
      shipmentId: r.shipment_id,
      sku: opt(r.sku),
      description: opt(r.description),
      unitPrice: r.unit_price,
      currency: r.unit_price_currency,
      unit: opt(r.quantity_unit),
      invoiceNumber: opt(r.invoice_number),
      date: iso(r.date),
    }));
  }

  async purchaseOrderCount(orgId: string): Promise<number> {
    const { rows } = await this.pool.query('select count(*)::int as n from purchase_orders where org_id = $1', [orgId]);
    return rows[0].n;
  }

  async purchaseOrderByNumber(orgId: string, poNumber: string): Promise<PurchaseOrder | null> {
    const { rows } = await this.pool.query('select * from purchase_orders where org_id = $1 and po_key = $2', [orgId, poKey(poNumber)]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, poNumber: r.po_number, ...(r.seller_name ? { sellerName: r.seller_name } : {}), ...(r.currency ? { currency: r.currency } : {}), lines: r.lines };
  }

  async listPurchaseOrders(orgId: string): Promise<PurchaseOrderSummary[]> {
    const { rows } = await this.pool.query(
      'select id, po_number, seller_name, currency, order_date, jsonb_array_length(lines) as lines, source, updated_at from purchase_orders where org_id = $1 order by updated_at desc, po_number',
      [orgId],
    );
    return rows.map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      ...(r.seller_name ? { sellerName: r.seller_name } : {}),
      ...(r.currency ? { currency: r.currency } : {}),
      ...(iso(r.order_date) ? { orderDate: iso(r.order_date) } : {}),
      lines: r.lines,
      ...(r.source ? { source: r.source } : {}),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /** Inserts or replaces (same PO number) each order; returns how many were new. */
  async upsertPurchaseOrders(orgId: string, userId: string, orders: PurchaseOrderInput[], source: string): Promise<{ created: number; updated: number }> {
    const client = await this.pool.connect();
    let created = 0;
    try {
      await client.query('begin');
      for (const o of orders) {
        const { rows } = await client.query(
          `insert into purchase_orders (id, org_id, user_id, po_number, po_key, seller_name, currency, order_date, lines, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           on conflict (org_id, po_key) do update set user_id = excluded.user_id, po_number = excluded.po_number, seller_name = excluded.seller_name, currency = excluded.currency,
             order_date = excluded.order_date, lines = excluded.lines, source = excluded.source, updated_at = now()
           returning (xmax = 0) as inserted`,
          [randomUUID(), orgId, userId, o.poNumber, poKey(o.poNumber), o.sellerName ?? null, o.currency ?? null, o.orderDate ?? null, JSON.stringify(o.lines), source],
        );
        if (rows[0].inserted) created++;
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
    return { created, updated: orders.length - created };
  }

  /** Deletes the order if it belongs to the organization; returns its PO number, or null. */
  async deletePurchaseOrder(orgId: string, id: string): Promise<string | null> {
    const { rows } = await this.pool.query('delete from purchase_orders where org_id = $1 and id = $2 returning po_number', [orgId, id]);
    return rows[0]?.po_number ?? null;
  }
}
