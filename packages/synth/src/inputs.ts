import type { CommercialInvoice, Party, PackingList } from '@doccheck/schemas';
import type { Rng } from './rng';

/**
 * Set v1-inputs: the documents of v1 shipments in the other forms they arrive in. The invoice and the
 * packing list as spreadsheets (an .xlsx and a .csv laid out like an exporter's own sheet), the
 * invoice as a phone photo (rotated, on a desk, JPEG), and the whole folder as one PDF. Truth and
 * labels are the shipment's own, so extraction is scored the same way.
 */

const partyRows = (label: string, p: Party | undefined): string[][] =>
  p ? [[label], [p.name], ...p.address.lines.map((l) => [l]), [[p.address.city, [p.address.region, p.address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ...(p.address.country ? [[p.address.country]] : [])] : [];

/** Two party blocks side by side (columns A and E). */
function sideBySide(a: string[][], b: string[][]): string[][] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i]?.[0] ?? '', '', '', '', b[i]?.[0] ?? '']);
}

/**
 * Line table headers: the usual ones, or (`plain` false) words an exporter's own template might use
 * that the header vocabulary does not know ("Pieces shipped", "Price each"), which the model maps.
 */
const INVOICE_HEADERS = {
  usual: ['No.', 'SKU', 'Description', 'HS code', 'Origin', 'Qty', 'Unit', 'Unit price', 'Amount'],
  own: ['Item', 'Ref.', 'Goods', 'Tariff no.', 'Made in', 'Pieces shipped', 'UoM', 'Price each', 'Line value'],
};

export function invoiceGrid(inv: CommercialInvoice, plain = true): string[][] {
  return [
    ['COMMERCIAL INVOICE'],
    [],
    ['Invoice No.', inv.invoiceNumber, '', '', 'Date', inv.invoiceDate ?? ''],
    ['PO No.', inv.poNumber ?? '', '', '', 'Currency', inv.currency],
    ['Terms of sale', inv.incoterm ? `${inv.incoterm.code} ${inv.incoterm.place}` : '', '', '', 'Date of shipment', inv.shipmentDate ?? ''],
    ['Mode of transport', inv.transport?.mode === 'AIR' ? 'Air' : inv.transport?.mode === 'ROAD' ? 'Road' : 'Sea', '', '', 'Port of loading', inv.transport?.placeOfShipment?.name ?? ''],
    ...(inv.portOfEntry ? [['Port of entry', inv.portOfEntry.name]] : []),
    [],
    ...sideBySide(partyRows('Seller', inv.seller), partyRows('Buyer', inv.buyer)),
    [],
    ...(inv.consignee ? [...partyRows('Consignee', inv.consignee), []] : []),
    plain ? INVOICE_HEADERS.usual : INVOICE_HEADERS.own,
    ...inv.lines.map((l) => [String(l.lineNo), l.sku ?? '', l.description, l.hsCode ?? '', l.countryOfOrigin ?? '', l.quantity.value, l.quantity.unit, l.unitPrice.amount, l.lineTotal.amount]),
    ['', '', 'TOTAL', '', '', '', '', '', inv.invoiceTotal.amount],
    [],
    ['Packages', String(inv.packageCount ?? '')],
    ['Gross weight', inv.grossWeight ? `${inv.grossWeight.raw.value} ${inv.grossWeight.raw.unit}` : ''],
    ['Net weight', inv.netWeight ? `${inv.netWeight.raw.value} ${inv.netWeight.raw.unit}` : ''],
  ];
}

export function packingGrid(pl: PackingList): string[][] {
  return [
    ['PACKING LIST'],
    ['Packing list no.', pl.packingListNumber ?? '', '', 'Invoice no.', pl.invoiceRef ?? ''],
    [],
    ...sideBySide(partyRows('Seller', pl.seller), partyRows('Consignee', pl.consignee)),
    [],
    ['C/No.', 'Cartons', 'Type', 'SKU', 'Description', 'Qty', 'Unit', 'N.W. (KG)', 'G.W. (KG)', 'Meas (cm)'],
    ...pl.packages.map((p) => [p.range, String(p.count), p.type, p.contents[0]?.sku ?? '', p.contents[0]?.description ?? '', p.contents[0]?.quantity.value ?? '', p.contents[0]?.quantity.unit ?? '', p.netWeight?.kg ?? '', p.grossWeight?.kg ?? '', p.dimensionsCm?.join('x') ?? '']),
    ['TOTAL', String(pl.totals.packageCount), '', '', '', '', '', pl.totals.netWeight?.kg ?? '', pl.totals.grossWeight?.kg ?? '', '', pl.totals.volumeM3 ?? ''],
  ];
}

/**
 * Several HTML documents as one, each starting on a new page, for a PDF that holds the whole folder.
 * Each document's CSS is scoped to its own container so the layouts do not mix.
 */
export function combineHtml(docs: string[]): string {
  const parts = docs.map((html, i) => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
    const scoped = css
      .replace(/@page\s*\{[^}]*\}/g, '')
      .replace(/([^{}]+)\{/g, (_, selectors: string) => `${selectors.split(',').map((sel) => (sel.trim() === 'body' ? `.doc-${i}` : `.doc-${i} ${sel.trim()}`)).join(', ')} {`);
    return { scoped, body: `<div class="doc-${i}"${i ? ' style="page-break-before: always"' : ''}>${body}</div>` };
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shipment documents</title><style>@page { size: A4; margin: 14mm 12mm 16mm; } thead { display: table-header-group; } tr { page-break-inside: avoid; } ${parts.map((p) => p.scoped).join('\n')}</style></head><body>${parts.map((p) => p.body).join('\n')}</body></html>`;
}

export interface PhotoStyle {
  /** Degrees the sheet is turned on the desk. */
  rotation: number;
  /** Fraction of the photo the sheet takes. */
  fill: number;
  quality: number;
}

export const photoStyle = (rng: Rng): PhotoStyle => ({ rotation: Math.round((rng.chance(0.5) ? 1 : -1) * rng.int(15, 60)) / 10, fill: rng.int(78, 90) / 100, quality: rng.int(70, 85) });

/** A page screenshot (PNG) as a phone photo of it: the sheet turned on a dark desk, warm light, JPEG. */
export async function photoOf(png: Buffer, style: PhotoStyle): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const page = await loadImage(png);
  const scale = (style.fill * 1800) / Math.max(page.width, page.height);
  const w = Math.round(page.width * scale);
  const h = Math.round(page.height * scale);
  const W = Math.round(w / style.fill);
  const H = Math.round(h / style.fill);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const desk = ctx.createLinearGradient(0, 0, W, H);
  desk.addColorStop(0, '#4a3b2c');
  desk.addColorStop(1, '#2c231b');
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((style.rotation * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 18;
  ctx.drawImage(page, -w / 2, -h / 2, w, h);
  ctx.restore();
  // Uneven light from one side.
  const light = ctx.createLinearGradient(0, 0, W, 0);
  light.addColorStop(0, 'rgba(255,240,210,0.10)');
  light.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  return canvas.encode('jpeg', style.quality);
}
