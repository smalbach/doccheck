import { CurrencyCode, Decimal, IsoDate } from '@doccheck/schemas';
import { z } from 'zod';

/** One purchase order as imported (JSON), the shape rule X24 reads. Decimals stay strings. */
export const PurchaseOrderInput = z.object({
  poNumber: z.string().trim().min(1).max(80),
  sellerName: z.string().trim().max(200).optional(),
  currency: CurrencyCode.optional(),
  orderDate: IsoDate.optional(),
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().positive().optional(),
        sku: z.string().trim().max(80).optional(),
        description: z.string().trim().max(500).optional(),
        quantity: Decimal,
        unit: z.string().trim().max(20).optional(),
        unitPrice: Decimal.optional(),
      }).refine((l) => !!(l.sku || l.description), 'A line needs a SKU or a description'),
    )
    .min(1)
    .max(1000),
});
export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInput>;

export const PurchaseOrdersInput = z.array(PurchaseOrderInput).min(1).max(500);

export const poKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Cells of one CSV line (RFC 4180 quotes; comma or semicolon separated). */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur.trim()), (cur = '');
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Header names accepted for each field (lower case, spaces and underscores removed). */
const HEADERS: Record<string, string[]> = {
  poNumber: ['ponumber', 'po', 'pono', 'purchaseorder', 'order', 'ordernumber'],
  lineNo: ['line', 'lineno', 'linenumber'],
  sku: ['sku', 'item', 'itemcode', 'partnumber', 'article'],
  description: ['description', 'desc', 'itemdescription'],
  quantity: ['quantity', 'qty'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  unitPrice: ['unitprice', 'price'],
  currency: ['currency', 'cur'],
  sellerName: ['seller', 'sellername', 'supplier', 'vendor'],
  orderDate: ['orderdate', 'date', 'podate'],
};

/** "1,234.50" or "1.234,50" or "1234.5" → "1234.50" style decimal string; null when not a number. */
function decimal(raw: string): string | null {
  let v = raw.replace(/[\s'$€£]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v) || /^\d+,\d+$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(v) ? v : null;
}

/**
 * Purchase orders from a CSV with one row per order line and a header row: PO number, SKU and/or
 * description, quantity; optionally line, unit, unit price, currency, seller, order date. Rows of the
 * same PO number make one order. Errors name the row they come from.
 */
export function parsePurchaseOrdersCsv(text: string): { orders: PurchaseOrderInput[]; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { orders: [], errors: ['The CSV needs a header row and at least one line.'] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = cells(lines[0], sep).map((h) => h.toLowerCase().replace(/[\s_.#-]+/g, ''));
  const col: Record<string, number> = {};
  for (const [field, names] of Object.entries(HEADERS)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  const errors: string[] = [];
  for (const required of ['poNumber', 'quantity']) if (col[required] === undefined) errors.push(`Missing column: ${required === 'poNumber' ? 'PO number' : 'quantity'}.`);
  if (col.sku === undefined && col.description === undefined) errors.push('Missing column: SKU or description.');
  if (errors.length) return { orders: [], errors };

  const orders = new Map<string, PurchaseOrderInput>();
  lines.slice(1).forEach((line, n) => {
    const row = cells(line, sep);
    const get = (f: string) => (col[f] === undefined ? undefined : row[col[f]] || undefined);
    const where = `Row ${n + 2}`;
    const po = get('poNumber');
    const quantity = decimal(get('quantity') ?? '');
    const price = get('unitPrice');
    const unitPrice = price === undefined ? undefined : decimal(price);
    if (!po) return void errors.push(`${where}: no PO number.`);
    if (!quantity) return void errors.push(`${where}: quantity "${get('quantity') ?? ''}" is not a number.`);
    if (unitPrice === null) return void errors.push(`${where}: unit price "${price}" is not a number.`);
    if (!get('sku') && !get('description')) return void errors.push(`${where}: no SKU or description.`);
    const key = poKey(po);
    const order = orders.get(key) ?? { poNumber: po, lines: [] };
    const currency = get('currency')?.toUpperCase();
    if (currency && /^[A-Z]{3}$/.test(currency)) order.currency ??= currency;
    if (get('sellerName')) order.sellerName ??= get('sellerName');
    const date = get('orderDate');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) order.orderDate ??= date;
    const lineNo = Number(get('lineNo'));
    order.lines.push({
      ...(Number.isInteger(lineNo) && lineNo > 0 ? { lineNo } : {}),
      ...(get('sku') ? { sku: get('sku') } : {}),
      ...(get('description') ? { description: get('description') } : {}),
      quantity,
      ...(get('unit') ? { unit: get('unit') } : {}),
      ...(unitPrice ? { unitPrice } : {}),
    });
    orders.set(key, order);
  });
  return { orders: [...orders.values()], errors };
}
