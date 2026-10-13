import type { Address, BillOfLading, CommercialInvoice, Location, PackingList, Party, Weight } from '@doccheck/schemas';
import type { RenderOptions } from './generate';
import { esc } from './render';

/**
 * Layouts added in set v2. They live apart from render.ts so the v1 HTML (and the cached model
 * answers keyed on its text) never changes.
 *   euro  letterhead layout with European formats: "48.600,00" money, "1 140,50 kg", "14.03.2026"
 *   grid  numbered-box form in the style of a customs invoice form: "1 Exporter", "2 Consignee"...
 */

export const V2_TEMPLATES = ['euro', 'grid'] as const;
type V2Style = (typeof V2_TEMPLATES)[number];

export const isV2Template = (t: string): t is V2Style => (V2_TEMPLATES as readonly string[]).includes(t);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function date(iso: string | undefined, style: V2Style): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return style === 'euro' ? `${d}.${m}.${y}` : `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function group(intPart: string, sep: string) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Money: "48.600,00" (euro) or "48,600.00" (grid). Always two decimals. */
function money(v: string, style: V2Style): string {
  const [i, f = ''] = v.split('.');
  const frac = f.padEnd(2, '0');
  return style === 'euro' ? `${group(i, '.')},${frac}` : `${group(i, ',')}.${frac}`;
}

/** Quantities and weights: "1 140,50" (euro, no-break space groups) or "1,140.50" (grid). */
function amount(v: string | number | undefined, style: V2Style): string {
  if (v === undefined) return '';
  const [i, f] = String(v).split('.');
  return style === 'euro' ? `${group(i, ' ')}${f !== undefined ? `,${f}` : ''}` : `${group(i, ',')}${f !== undefined ? `.${f}` : ''}`;
}

const w = (x: Weight | undefined, style: V2Style) => (x ? `${amount(x.raw.value, style)} ${style === 'euro' ? x.raw.unit.toLowerCase() : x.raw.unit}` : '');

function address(a: Address): string {
  const cityLine = [a.postalCode, a.city, a.region].filter(Boolean).join(' ');
  return [...a.lines, cityLine, a.country].filter(Boolean).map(esc).join('<br>');
}

const party = (p: Party | undefined) => (p ? `<strong>${esc(p.name)}</strong><br>${address(p.address)}${p.taxId ? `<br>VAT/Tax No. ${esc(p.taxId)}` : ''}` : '');
const place = (l: Location | undefined) => (l ? esc(`${l.name} (${l.unLocode ?? l.country})`) : '');

const CSS: Record<V2Style, string> = {
  euro: `
    * { box-sizing: border-box; } body { font-family: 'DejaVu Sans', Verdana, sans-serif; font-size: 9.5px; color: #222; margin: 0; }
    .letterhead { border-bottom: 1px solid #999; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; }
    .letterhead .co { font-size: 15px; font-weight: bold; } .letterhead .addr { color: #555; }
    h1 { font-size: 13px; font-weight: bold; margin: 0 0 8px; letter-spacing: 0.04em; }
    .kv { width: 100%; border-collapse: collapse; margin-bottom: 8px; } .kv td { padding: 2px 6px 2px 0; vertical-align: top; } .kv td.k { color: #666; white-space: nowrap; width: 1%; }
    .two { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 14px; margin: 0 2px 10px 0; } .two > div { border: 1px solid #bbb; padding: 5px 7px; }
    .cap { font-size: 8px; color: #666; display: block; margin-bottom: 2px; }
    table.items { width: 100%; border-collapse: collapse; } table.items th { background: #e8e8e8; border: 1px solid #bbb; padding: 3px 4px; text-align: left; font-weight: bold; font-size: 8.5px; }
    table.items td { border: 1px solid #ccc; padding: 3px 4px; vertical-align: top; } .num { text-align: right; white-space: nowrap; }
    .sum { width: 50%; margin-left: auto; margin-top: 8px; border-collapse: collapse; } .sum td { padding: 2px 4px; } .sum tr.grand td { border-top: 2px solid #222; font-weight: bold; }
    .foot { margin-top: 14px; font-size: 8.5px; color: #555; }`,
  grid: `
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 4px; text-transform: uppercase; } .sub { text-align: center; font-size: 8px; margin-bottom: 6px; }
    table.form { width: 100%; border-collapse: collapse; } table.form td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; height: 34px; }
    .n { font-size: 7.5px; font-weight: bold; display: block; margin-bottom: 2px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: -1px; } table.items th { border: 1px solid #000; padding: 2px 3px; font-size: 7.5px; text-align: center; background: #f2f2f2; }
    table.items td { border-left: 1px solid #000; border-right: 1px solid #000; border-bottom: 1px dotted #888; padding: 2px 3px; vertical-align: top; } .num { text-align: right; white-space: nowrap; }
    table.items tbody.totals td { border: 1px solid #000; font-weight: bold; }`,
};

function page(title: string, style: V2Style, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 12mm 11mm 16mm; } ${CSS[style]}
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body>${body}</body></html>`;
}

const letterhead = (p: Party | undefined, right: string) =>
  `<div class="letterhead"><div>${p ? `<div class="co">${esc(p.name)}</div><div class="addr">${esc([...p.address.lines, [p.address.postalCode, p.address.city].filter(Boolean).join(' '), p.address.country].join(' · '))}${p.taxId ? ` · VAT ${esc(p.taxId)}` : ''}</div>` : ''}</div><div>${right}</div></div>`;

const kv = (rows: [string, string][]) => `<table class="kv">${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>`;

const box = (n: number, label: string, value: string, attrs = '') => `<td${attrs}><span class="n">${n}. ${esc(label)}</span>${value}</td>`;

export function renderInvoiceV2(inv: CommercialInvoice, opts: RenderOptions): string {
  const style = opts.invoiceTemplate as V2Style;
  const cur = inv.currency;
  const terms = inv.incoterm ? `${inv.incoterm.code} ${inv.incoterm.place}` : '';
  const freight = inv.charges?.freight;

  if (style === 'euro') {
    const rows = inv.lines
      .map((l) => `<tr><td>${l.lineNo}</td><td>${esc(l.sku)}</td><td>${esc(l.description)}</td><td>${esc(l.hsCode)}</td><td>${esc(l.countryOfOrigin)}</td><td class="num">${amount(l.quantity.value, style)} ${esc(l.quantity.unit)}</td><td class="num">${money(l.unitPrice.amount, style)}${l.unitPrice.currency !== cur ? ' ' + esc(l.unitPrice.currency) : ''}</td><td class="num">${money(l.lineTotal.amount, style)}${l.lineTotal.currency !== cur ? ' ' + esc(l.lineTotal.currency) : ''}</td></tr>`)
      .join('');
    const body = `${letterhead(inv.seller, `<h1>COMMERCIAL INVOICE</h1>${kv([['Document No.', `<strong>${esc(inv.invoiceNumber)}</strong>`], ['Invoice date', date(inv.invoiceDate, style)], ['Your order', esc(inv.poNumber)], ['Dispatch date', date(inv.shipmentDate, style)]])}`)}
      <div class="two"><div><span class="cap">Invoice to</span>${party(inv.buyer)}</div><div><span class="cap">Delivery address / Consignee</span>${party(inv.consignee)}</div></div>
      ${kv([['Delivery terms (Incoterms® 2020)', esc(terms)], ['Payment', esc(inv.paymentTerms)], ['Shipped by', `${esc(inv.transport?.mode)} from ${place(inv.transport?.placeOfShipment)}`], ...(inv.portOfEntry ? [['Port of entry', place(inv.portOfEntry)] as [string, string]] : []), ['Currency', esc(cur)]])}
      <table class="items"><thead><tr><th>Pos.</th><th>Article</th><th>Description</th><th>Tariff code</th><th>Origin</th><th class="num">Quantity</th><th class="num">Unit price ${esc(cur)}</th><th class="num">Value ${esc(cur)}</th></tr></thead><tbody>${rows}</tbody></table>
      <table class="sum">
        <tr><td>Number of packages</td><td class="num">${amount(inv.packageCount, style)}</td></tr>
        <tr><td>Net weight</td><td class="num">${w(inv.netWeight, style)}</td></tr>
        <tr><td>Gross weight</td><td class="num">${w(inv.grossWeight, style)}</td></tr>
        ${freight ? `<tr><td>Freight costs</td><td class="num">${esc(freight.currency)} ${money(freight.amount, style)}</td></tr>` : ''}
        <tr class="grand"><td>Invoice total</td><td class="num">${esc(inv.invoiceTotal.currency)} ${money(inv.invoiceTotal.amount, style)}</td></tr>
      </table>
      <div class="foot">We hereby certify that this invoice shows the actual price of the goods described. ${esc(inv.responsiblePerson)}</div>`;
    return page(`Commercial invoice ${inv.invoiceNumber}`, style, body);
  }

  const rows = inv.lines
    .map((l) => `<tr><td>${l.lineNo}</td><td>${esc(l.description)}<br>SKU ${esc(l.sku)}</td><td>${esc(l.hsCode)}</td><td>${esc(l.countryOfOrigin)}</td><td class="num">${amount(l.quantity.value, style)}</td><td>${esc(l.quantity.unit)}</td><td class="num">${money(l.unitPrice.amount, style)}${l.unitPrice.currency !== cur ? ' ' + esc(l.unitPrice.currency) : ''}</td><td class="num">${money(l.lineTotal.amount, style)}${l.lineTotal.currency !== cur ? ' ' + esc(l.lineTotal.currency) : ''}</td></tr>`)
    .join('');
  const body = `<h1>Commercial Invoice</h1><div class="sub">All amounts in ${esc(cur)} unless stated otherwise</div>
    <table class="form">
      <tr>${box(1, 'Exporter / Vendor', party(inv.seller), ' rowspan="2" style="width:50%"')}${box(2, 'Invoice number and date', `${esc(inv.invoiceNumber)}<br>${date(inv.invoiceDate, style)}`)}</tr>
      <tr>${box(3, 'Purchaser order number', esc(inv.poNumber))}</tr>
      <tr>${box(4, 'Consignee', party(inv.consignee))}${box(5, 'Purchaser (if other than consignee)', party(inv.buyer))}</tr>
      <tr>${box(6, 'Transportation: mode and place of direct shipment', `${esc(inv.transport?.mode)} · ${place(inv.transport?.placeOfShipment)}<br>Date of direct shipment: ${date(inv.shipmentDate, style)}${inv.portOfEntry ? `<br>Port of entry: ${place(inv.portOfEntry)}` : ''}`)}${box(7, 'Conditions of sale and terms of payment', `${esc(terms)}<br>${esc(inv.paymentTerms)}`)}</tr>
      <tr>${box(8, 'Currency of settlement', esc(cur))}${box(9, 'Number of packages', amount(inv.packageCount, style))}</tr>
    </table>
    <table class="items"><thead><tr><th>10. Item</th><th>11. Description of goods</th><th>12. HS code</th><th>13. Origin</th><th>14. Quantity</th><th>Unit</th><th>15. Unit price</th><th>16. Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tbody class="totals"><tr><td colspan="7">17. Invoice total (${esc(inv.invoiceTotal.currency)})</td><td class="num">${money(inv.invoiceTotal.amount, style)}</td></tr></tbody></table>
    <table class="form"><tr>${box(18, 'Weight', `Net: ${w(inv.netWeight, style)}<br>Gross: ${w(inv.grossWeight, style)}`)}${box(19, 'Transportation charges', freight ? `Freight ${esc(freight.currency)} ${money(freight.amount, style)}` : 'Not included')}${box(20, 'Signed', esc(inv.responsiblePerson))}</tr></table>`;
  return page(`Commercial invoice ${inv.invoiceNumber}`, style, body);
}

export function renderPackingListV2(pl: PackingList, opts: RenderOptions): string {
  const style = opts.packingListTemplate as V2Style;
  const t = pl.totals;
  const rows = pl.packages
    .map((g) => {
      const c = g.contents[0];
      return `<tr><td>${esc(g.range)}</td><td class="num">${amount(g.count, style)}</td><td>${esc(g.type)}</td><td>${esc(c.description)}${c.sku ? ` (${esc(c.sku)})` : ''}</td><td class="num">${amount(c.quantity.value, style)} ${esc(c.quantity.unit)}</td><td class="num">${w(g.netWeight, style)}</td><td class="num">${w(g.grossWeight, style)}</td></tr>`;
    })
    .join('');
  const head = `<tr><th>Package nos.</th><th class="num">Qty pkgs</th><th>Kind</th><th>Contents</th><th class="num">Quantity</th><th class="num">Net weight</th><th class="num">Gross weight</th></tr>`;
  const totals = `<tr><td>Total</td><td class="num">${amount(t.packageCount, style)}</td><td colspan="3"></td><td class="num">${w(t.netWeight, style)}</td><td class="num">${w(t.grossWeight, style)}</td></tr>`;
  const marks = pl.packages[0]?.marks;

  if (style === 'euro') {
    const body = `${letterhead(pl.seller, `<h1>PACKING LIST</h1>${kv([['Packing list No.', `<strong>${esc(pl.packingListNumber)}</strong>`], ['Ref. invoice', esc(pl.invoiceRef)]])}`)}
      <div class="two"><div><span class="cap">Consignee</span>${party(pl.consignee)}</div><div><span class="cap">Shipping marks</span>${esc(marks)}<br><br><span class="cap">Volume</span>${amount(t.volumeM3, style)} m³</div></div>
      <table class="items"><thead>${head}</thead><tbody>${rows}</tbody><tbody class="totals">${totals}</tbody></table>`;
    return page(`Packing list ${pl.packingListNumber ?? ''}`, style, body);
  }
  const body = `<h1>Packing List</h1><div class="sub">Detailed statement of packages</div>
    <table class="form">
      <tr>${box(1, 'Shipper', party(pl.seller), ' style="width:50%"')}${box(2, 'Packing list no. / Invoice no.', `${esc(pl.packingListNumber)}<br>Invoice: ${esc(pl.invoiceRef)}`)}</tr>
      <tr>${box(3, 'Consignee', party(pl.consignee))}${box(4, 'Marks and numbers', `${esc(marks)}<br>Volume: ${amount(t.volumeM3, style)} CBM`)}</tr>
    </table>
    <table class="items"><thead>${head}</thead><tbody>${rows}</tbody><tbody class="totals">${totals}</tbody></table>`;
  return page(`Packing list ${pl.packingListNumber ?? ''}`, style, body);
}

export function renderBillOfLadingV2(bl: BillOfLading, opts: RenderOptions): string {
  const style = opts.blTemplate as V2Style;
  const title = bl.blType?.form === 'SEAWAY' ? 'Non-negotiable Sea Waybill' : 'Bill of Lading for Combined Transport or Port to Port Shipment';
  const containers = bl.containers
    .map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.seal)}</td><td>${esc(c.type)}</td><td class="num">${amount(c.packages, style)}</td><td class="num">${w(c.grossWeight, style)}</td><td class="num">${amount(c.volumeM3, style)}</td></tr>`)
    .join('');
  const cTable = `<table class="items"><thead><tr><th>Container No.</th><th>Seal No.</th><th>Size/Type</th><th class="num">Packages</th><th class="num">Gross weight</th><th class="num">Measurement m³</th></tr></thead><tbody>${containers}</tbody></table>`;
  const cargo = `<table class="items"><thead><tr><th>Marks and Nos.</th><th class="num">Number and kind of packages</th><th>Description of goods (said to contain)</th><th class="num">Gross weight</th></tr></thead>
    <tbody><tr><td>${esc(bl.marksAndNumbers)}</td><td class="num">${amount(bl.totalPackages, style)}</td><td>${esc(bl.cargoDescription)}${bl.references?.length ? `<br>Ref.: ${esc(bl.references.join(', '))}` : ''}<br>Freight ${esc(bl.freightTerms)}</td><td class="num">${w(bl.totalGrossWeight, style)}</td></tr></tbody></table>`;

  if (style === 'euro') {
    const body = `<div class="letterhead"><div><div class="co">${esc(bl.carrier?.name)}</div><div class="addr">SCAC ${esc(bl.carrier?.scac)} · ${bl.blType?.issuer === 'HBL' ? 'House' : 'Ocean'} bill</div></div><div><h1>${esc(title.toUpperCase())}</h1>${kv([['B/L No.', `<strong>${esc(bl.blNumber)}</strong>`], ['Booking ref.', esc(bl.bookingNumber)]])}</div></div>
      <div class="two"><div><span class="cap">Shipper</span>${party(bl.shipper)}</div><div><span class="cap">Consignee</span>${party(bl.consignee)}</div><div><span class="cap">Notify address</span>${party(bl.notifyParty)}</div></div>
      ${kv([['Vessel', esc(bl.vessel)], ['Voyage No.', esc(bl.voyage)], ['Place of receipt', place(bl.placeOfReceipt)], ['Port of loading', place(bl.portOfLoading)], ['Port of discharge', place(bl.portOfDischarge)], ['Place of delivery', place(bl.placeOfDelivery)]])}
      ${cargo}<br>${cTable}
      <div class="foot">Shipped on board: ${date(bl.shippedOnBoardDate, style)} · Place and date of issue: ${esc(bl.placeOfIssue)}, ${date(bl.dateOfIssue, style)}</div>`;
    return page(`${title} ${bl.blNumber}`, style, body);
  }
  const body = `<h1>${esc(title)}</h1><div class="sub">${esc(bl.carrier?.name)} (SCAC ${esc(bl.carrier?.scac)})</div>
    <table class="form">
      <tr>${box(1, 'Shipper', party(bl.shipper), ' style="width:50%"')}${box(2, 'B/L number · Booking number', `${esc(bl.blNumber)}<br>Booking ${esc(bl.bookingNumber)}`)}</tr>
      <tr>${box(3, 'Consignee', party(bl.consignee))}${box(4, 'Notify party', party(bl.notifyParty))}</tr>
      <tr>${box(5, 'Ocean vessel / Voyage', `${esc(bl.vessel)} / ${esc(bl.voyage)}`)}${box(6, 'Place of receipt', place(bl.placeOfReceipt))}</tr>
      <tr>${box(7, 'Port of loading', place(bl.portOfLoading))}${box(8, 'Port of discharge', place(bl.portOfDischarge))}</tr>
      <tr>${box(9, 'Place of delivery', place(bl.placeOfDelivery))}${box(10, 'Shipped on board date', date(bl.shippedOnBoardDate, style))}</tr>
    </table>
    ${cargo}${cTable}
    <table class="form"><tr>${box(11, 'Place and date of issue', `${esc(bl.placeOfIssue)} · ${date(bl.dateOfIssue, style)}`)}${box(12, 'Freight payable', esc(bl.freightTerms))}</tr></table>`;
  return page(`${title} ${bl.blNumber}`, style, body);
}
