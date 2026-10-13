import type { Address, BillOfLading, CommercialInvoice, Location, PackingList, Party, Weight } from '@doccheck/schemas';
import type { RenderOptions } from './generate';

/**
 * HTML templates for the three paper documents. Each template varies layout, labels, number and
 * date formats, so extraction cannot rely on one fixed position or spelling. The ISF is an
 * electronic filing; its printed confirmation is in isf.ts and only goes into data/eval/v1-isf.
 */

export type Style = 'classic' | 'modern' | 'legacy';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function date(iso: string | undefined, style: Style): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (style === 'legacy') return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
  if (style === 'modern') return `${MONTHS[Number(m) - 1][0]}${MONTHS[Number(m) - 1].slice(1).toLowerCase()} ${Number(d)}, ${y}`;
  return iso;
}

/** "48600.00" -> "48,600.00" (legacy keeps the plain form). */
function num(v: string | undefined, style: Style): string {
  if (v === undefined) return '';
  if (style === 'legacy') return v;
  const [i, f] = v.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f !== undefined ? `${grouped}.${f}` : grouped;
}

const w = (x: Weight | undefined, style: Style) => (x ? `${num(x.raw.value, style)} ${x.raw.unit === 'KG' && style === 'legacy' ? 'KGS' : x.raw.unit}` : '');

export function address(a: Address, style: Style): string {
  const cityLine = [a.city, a.region, a.postalCode].filter(Boolean).join(style === 'legacy' ? ' ' : ', ');
  const rows = [...a.lines, cityLine, a.country].filter(Boolean);
  return rows.map((r) => esc(style === 'legacy' ? r.toUpperCase() : r)).join('<br>');
}

export function party(p: Party | undefined, style: Style): string {
  if (!p) return '';
  const name = style === 'legacy' ? p.name.toUpperCase() : p.name;
  const tax = p.taxId ? `<br>${style === 'legacy' ? 'TAX ID' : 'Tax ID'}: ${esc(p.taxId)}` : '';
  return `<strong>${esc(name)}</strong><br>${address(p.address, style)}${tax}`;
}

const place = (l: Location | undefined, style: Style) => (l ? esc(style === 'legacy' ? `${l.name.toUpperCase()}, ${l.country}` : `${l.name}, ${l.country}`) : '');

const CSS: Record<Style, string> = {
  classic: `
    body { font-family: 'Times New Roman', Times, serif; font-size: 11px; color: #111; margin: 0; }
    h1 { text-align: center; font-size: 20px; letter-spacing: 2px; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
    th { background: #eee; font-weight: bold; text-align: left; }
    .grid td { width: 50%; } .label { font-size: 9px; text-transform: uppercase; color: #444; display: block; margin-bottom: 2px; }
    .num { text-align: right; white-space: nowrap; } .totals td { font-weight: bold; }
    .sign { margin-top: 28px; }`,
  modern: `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5px; color: #1f2937; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f766e; padding-bottom: 8px; margin-bottom: 14px; }
    h1 { font-size: 24px; color: #0f766e; margin: 0; font-weight: 600; }
    .meta { text-align: right; line-height: 1.6; } .meta b { color: #6b7280; font-weight: 500; margin-right: 6px; }
    .cols { display: flex; gap: 16px; margin-bottom: 14px; } .cols > div { flex: 1; background: #f3f4f6; padding: 8px 10px; border-radius: 4px; }
    .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #0f766e; display: block; margin-bottom: 4px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 9px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 6px 4px; }
    td { padding: 6px 4px; border-bottom: 1px solid #e5e7eb; vertical-align: top; } .num { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: 45%; margin-top: 10px; } .totals td { border: none; padding: 3px 4px; } .totals tr:last-child td { font-weight: 700; font-size: 12px; border-top: 2px solid #0f766e; }
    .note { margin-top: 18px; color: #6b7280; font-size: 9.5px; }`,
  legacy: `
    body { font-family: 'Courier New', Courier, monospace; font-size: 10px; color: #000; margin: 0; }
    h1 { font-size: 15px; margin: 0 0 6px; text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 2px 4px; vertical-align: top; }
    th { border-top: 1px dashed #000; border-bottom: 1px dashed #000; text-align: left; font-weight: normal; }
    .box { border: 1px solid #000; padding: 4px; } .label { display: block; }
    .num { text-align: right; } .totals td { border-top: 1px dashed #000; } pre { font-family: inherit; margin: 0; }`,
};

export function page(title: string, style: Style, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4; margin: 14mm 12mm 16mm; } ${CSS[style]}
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body>${body}</body></html>`;
}

/** Label in English, or "French / English" on a bilingual Canadian invoice. */
function labels(bilingual: boolean, style: Style) {
  const fr: Record<string, string> = {
    'Commercial Invoice': 'Facture commerciale', Seller: 'Vendeur', Buyer: 'Acheteur', Consignee: 'Destinataire',
    'Invoice No.': 'N° de facture', Date: 'Date', 'Terms of Sale': 'Conditions de vente', Currency: 'Devise',
    Description: 'Désignation', Quantity: 'Quantité', 'Unit Price': 'Prix unitaire', Amount: 'Montant', Total: 'Total',
    'Country of Origin': "Pays d'origine", 'Gross Weight': 'Poids brut', 'Net Weight': 'Poids net', Packages: 'Colis',
  };
  return (en: string) => {
    const text = bilingual && fr[en] ? `${fr[en]} / ${en}` : en;
    return esc(style === 'legacy' ? text.toUpperCase() : text);
  };
}

export function renderInvoice(inv: CommercialInvoice, opts: RenderOptions): string {
  const style = opts.invoiceTemplate as Style;
  const L = labels(opts.bilingual, style);
  const cur = inv.currency;
  const money = (v: string) => num(v, style);
  const charges = inv.charges?.freight
    ? `<tr><td>${style === 'legacy' ? 'FREIGHT' : 'Freight'}</td><td class="num">${esc(inv.charges.freight.currency)} ${money(inv.charges.freight.amount)}</td></tr>`
    : '';
  const terms = inv.incoterm ? `${inv.incoterm.code} ${inv.incoterm.place}` : '';
  const origins = [...new Set(inv.lines.map((l) => l.countryOfOrigin).filter(Boolean))].join(', ');

  const rows = inv.lines
    .map((l) => {
      const desc = style === 'legacy' ? l.description.toUpperCase() : l.description;
      const sku = l.sku ? (style === 'modern' ? `<br><small>SKU ${esc(l.sku)}</small>` : '') : '';
      const hs = l.hsCode ? `${style === 'legacy' ? ' HS ' : '<br><small>HS '}${esc(l.hsCode)}${style === 'legacy' ? '' : '</small>'}` : '';
      const origin = style === 'classic' ? `<td>${esc(l.countryOfOrigin)}</td>` : '';
      const lead = style === 'legacy' ? `<td>${esc(l.sku)}</td>` : `<td>${l.lineNo}</td>`;
      return `<tr>${lead}<td>${esc(desc)}${sku}${hs}</td>${origin}<td class="num">${num(l.quantity.value, style)} ${esc(l.quantity.unit)}</td><td class="num">${money(l.unitPrice.amount)}${l.unitPrice.currency !== cur ? ' ' + esc(l.unitPrice.currency) : ''}</td><td class="num">${money(l.lineTotal.amount)}${l.lineTotal.currency !== cur ? ' ' + esc(l.lineTotal.currency) : ''}</td></tr>`;
    })
    .join('');

  const head = style === 'classic'
    ? `<tr><th>#</th><th>${L('Description')}</th><th>${L('Country of Origin')}</th><th class="num">${L('Quantity')}</th><th class="num">${L('Unit Price')} (${cur})</th><th class="num">${L('Amount')} (${cur})</th></tr>`
    : style === 'modern'
      ? `<tr><th>#</th><th>${L('Description')}</th><th class="num">${L('Quantity')}</th><th class="num">${L('Unit Price')}</th><th class="num">${L('Amount')}</th></tr>`
      : `<tr><th>ITEM</th><th>${L('Description')}</th><th class="num">QTY</th><th class="num">U/P ${cur}</th><th class="num">AMT ${cur}</th></tr>`;

  let body: string;
  if (style === 'classic') {
    body = `<h1>${L('Commercial Invoice')}</h1>
      <table class="grid">
        <tr><td><span class="label">${L('Seller')}</span>${party(inv.seller, style)}</td><td><span class="label">${L('Invoice No.')} / ${L('Date')}</span>${esc(inv.invoiceNumber)} &nbsp; ${date(inv.invoiceDate, style)}<br><span class="label">PO</span>${esc(inv.poNumber)}</td></tr>
        <tr><td><span class="label">${L('Buyer')}</span>${party(inv.buyer, style)}</td><td><span class="label">${L('Consignee')}</span>${party(inv.consignee, style)}</td></tr>
        <tr><td><span class="label">${L('Terms of Sale')}</span>${esc(terms)}<br><span class="label">Payment</span>${esc(inv.paymentTerms)}</td><td><span class="label">Shipment</span>${esc(inv.transport?.mode)} from ${place(inv.transport?.placeOfShipment, style)} · ${date(inv.shipmentDate, style)}${inv.portOfEntry ? `<br><span class="label">Port of entry</span>${place(inv.portOfEntry, style)}` : ''}<br><span class="label">${L('Currency')}</span>${esc(cur)}</td></tr>
      </table><br>
      <table><thead>${head}</thead><tbody>${rows}</tbody>
        <tbody class="totals"><tr><td colspan="5">${L('Total')} ${esc(inv.invoiceTotal.currency)}</td><td class="num">${money(inv.invoiceTotal.amount)}</td></tr></tbody></table><br>
      <table class="grid"><tr><td>${L('Packages')}: ${inv.packageCount ?? ''}<br>${L('Gross Weight')}: ${w(inv.grossWeight, style)}<br>${L('Net Weight')}: ${w(inv.netWeight, style)}</td>
        <td>${charges ? `<table>${charges}</table>` : ''}</td></tr></table>
      <div class="sign">I declare that all the information contained in this invoice is true and correct.<br><br>________________________<br>${esc(inv.responsiblePerson)}</div>`;
  } else if (style === 'modern') {
    body = `<header><div><h1>${L('Commercial Invoice')}</h1>${party(inv.seller, style)}</div>
        <div class="meta"><b>${L('Invoice No.')}</b>${esc(inv.invoiceNumber)}<br><b>${L('Date')}</b>${date(inv.invoiceDate, style)}<br><b>PO</b>${esc(inv.poNumber)}<br><b>${L('Terms of Sale')}</b>${esc(terms)}</div></header>
      <div class="cols"><div><span class="label">${L('Buyer')}</span>${party(inv.buyer, style)}</div><div><span class="label">${L('Consignee')}</span>${party(inv.consignee, style)}</div>
        <div><span class="label">Shipping</span>Ship date ${date(inv.shipmentDate, style)}<br>Via ${esc(inv.transport?.mode)} · ${place(inv.transport?.placeOfShipment, style)}${inv.portOfEntry ? `<br>Port of entry ${place(inv.portOfEntry, style)}` : ''}<br>${L('Country of Origin')}: ${esc(origins)}<br>${L('Packages')}: ${inv.packageCount ?? ''}</div></div>
      <table><thead>${head}</thead><tbody>${rows}</tbody></table>
      <table class="totals"><tr><td>${L('Net Weight')}</td><td class="num">${w(inv.netWeight, style)}</td></tr><tr><td>${L('Gross Weight')}</td><td class="num">${w(inv.grossWeight, style)}</td></tr>${charges}
        <tr><td>${L('Total')}</td><td class="num">${esc(inv.invoiceTotal.currency)} ${money(inv.invoiceTotal.amount)}</td></tr></table>
      <div class="note">Payment terms: ${esc(inv.paymentTerms)}. ${esc(inv.responsiblePerson)}.</div>`;
  } else {
    body = `<h1>${L('Commercial Invoice')}</h1>
      <table><tr><td class="box" style="width:55%"><span class="label">SHIPPER/EXPORTER:</span>${party(inv.seller, style)}</td><td class="box">INV NO: ${esc(inv.invoiceNumber)}<br>DATE: ${date(inv.invoiceDate, style)}<br>P/O: ${esc(inv.poNumber)}<br>TERMS: ${esc(terms.toUpperCase())}<br>CURRENCY: ${esc(cur)}</td></tr>
        <tr><td class="box"><span class="label">SOLD TO:</span>${party(inv.buyer, style)}</td><td class="box"><span class="label">SHIP TO:</span>${party(inv.consignee, style)}</td></tr>
        <tr><td class="box" colspan="2">FROM: ${place(inv.transport?.placeOfShipment, style)} BY ${esc(inv.transport?.mode)} ON/ABT ${date(inv.shipmentDate, style)}${inv.portOfEntry ? ` · PORT OF ENTRY: ${place(inv.portOfEntry, style)}` : ''} · ORIGIN: ${esc(origins)}</td></tr></table><br>
      <table><thead>${head}</thead><tbody>${rows}</tbody><tbody class="totals"><tr><td></td><td>TOTAL ${esc(inv.packageCount ?? '')} PKGS</td><td></td><td class="num">${esc(inv.invoiceTotal.currency)}</td><td class="num">${money(inv.invoiceTotal.amount)}</td></tr></tbody></table><br>
      <pre>N.W.: ${w(inv.netWeight, style)}    G.W.: ${w(inv.grossWeight, style)}${inv.charges?.freight ? `\nFREIGHT: ${esc(inv.charges.freight.currency)} ${money(inv.charges.freight.amount)}` : ''}\nPAYMENT: ${esc(inv.paymentTerms?.toUpperCase())}</pre>`;
  }
  return page(`Commercial invoice ${inv.invoiceNumber}`, style, body);
}

export function renderPackingList(pl: PackingList, opts: RenderOptions): string {
  const style = opts.packingListTemplate as Style;
  const up = (s: string) => (style === 'legacy' ? s.toUpperCase() : s);
  const rows = pl.packages
    .map((g) => {
      const c = g.contents[0];
      const dims = g.dimensionsCm ? g.dimensionsCm.join(style === 'legacy' ? 'X' : ' × ') : '';
      return `<tr><td>${esc(g.range)}</td><td class="num">${g.count} ${esc(g.type)}</td><td>${esc(up(c.description))}${style !== 'legacy' && c.sku ? `<br><small>${esc(c.sku)}</small>` : ''}</td><td class="num">${num(c.quantity.value, style)} ${esc(c.quantity.unit)}</td><td class="num">${w(g.netWeight, style)}</td><td class="num">${w(g.grossWeight, style)}</td>${style === 'legacy' ? '' : `<td class="num">${dims}</td>`}</tr>`;
    })
    .join('');
  const head = style === 'legacy'
    ? '<tr><th>C/NO.</th><th class="num">PKGS</th><th>DESCRIPTION</th><th class="num">QTY</th><th class="num">N.W.</th><th class="num">G.W.</th></tr>'
    : `<tr><th>${up('Carton No.')}</th><th class="num">${up('Packages')}</th><th>${up('Description')}</th><th class="num">${up('Quantity')}</th><th class="num">${up('Net Weight')}</th><th class="num">${up('Gross Weight')}</th><th class="num">${up('Dimensions (cm)')}</th></tr>`;
  const t = pl.totals;
  const cols = style === 'legacy' ? 6 : 7;
  const totals = `<tr><td><strong>${up('Total')}</strong></td><td class="num"><strong>${t.packageCount}</strong></td><td colspan="2"></td><td class="num"><strong>${w(t.netWeight, style)}</strong></td><td class="num"><strong>${w(t.grossWeight, style)}</strong></td>${cols === 7 ? `<td class="num">${t.volumeM3 ? `${t.volumeM3} m³` : ''}</td>` : ''}</tr>`;
  const marks = pl.packages[0]?.marks;

  const header = style === 'modern'
    ? `<header><div><h1>Packing List</h1>${party(pl.seller, style)}</div><div class="meta"><b>Packing list</b>${esc(pl.packingListNumber)}<br><b>Invoice</b>${esc(pl.invoiceRef)}</div></header>
       <div class="cols"><div><span class="label">Consignee</span>${party(pl.consignee, style)}</div><div><span class="label">Shipping marks</span>${esc(marks)}</div></div>`
    : `<h1>${up('Packing List')}</h1><table class="grid"><tr><td class="box"><span class="label">${up('Shipper')}</span>${party(pl.seller, style)}</td><td class="box">${up('Packing List No.')}: ${esc(pl.packingListNumber)}<br>${up('Invoice No.')}: ${esc(pl.invoiceRef)}<br><br>${up('Marks')}: ${esc(marks)}</td></tr>
       <tr><td class="box" colspan="2"><span class="label">${up('Consignee')}</span>${party(pl.consignee, style)}</td></tr></table><br>`;
  const footer = style === 'legacy' ? `<pre>TOTAL: ${t.packageCount} PKGS  N.W. ${w(t.netWeight, style)}  G.W. ${w(t.grossWeight, style)}  MEAS. ${esc(t.volumeM3)} CBM</pre>` : '';
  return page(`Packing list ${pl.packingListNumber ?? ''}`, style, `${header}<table><thead>${head}</thead><tbody>${rows}</tbody><tbody class="totals">${totals}</tbody></table>${footer}`);
}

export function renderBillOfLading(bl: BillOfLading, opts: RenderOptions): string {
  const style = opts.blTemplate as Style;
  const up = (s: string) => (style === 'legacy' ? s.toUpperCase() : s);
  const title = bl.blType?.form === 'SEAWAY' ? 'Sea Waybill' : 'Bill of Lading';
  const issuer = bl.blType?.issuer === 'HBL' ? 'House' : 'Master';
  const containers = bl.containers
    .map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.seal)}</td><td>${esc(c.type)}</td><td class="num">${c.packages ?? ''}</td><td class="num">${w(c.grossWeight, style)}</td><td class="num">${esc(c.volumeM3)}</td></tr>`)
    .join('');
  const cHead = `<tr><th>${up('Container No.')}</th><th>${up('Seal No.')}</th><th>${up('Type')}</th><th class="num">${up('Packages')}</th><th class="num">${up('Gross Weight')}</th><th class="num">${up('CBM')}</th></tr>`;
  const route = [
    [up('Vessel / Voyage'), `${esc(bl.vessel)} / ${esc(bl.voyage)}`],
    [up('Place of Receipt'), place(bl.placeOfReceipt, style)],
    [up('Port of Loading'), place(bl.portOfLoading, style)],
    [up('Port of Discharge'), place(bl.portOfDischarge, style)],
    [up('Place of Delivery'), place(bl.placeOfDelivery, style)],
  ];
  const cargo = `<table><thead><tr><th>${up('Marks & Numbers')}</th><th class="num">${up('No. of Packages')}</th><th>${up('Description of Goods')}</th><th class="num">${up('Gross Weight')}</th></tr></thead>
    <tbody><tr><td>${esc(bl.marksAndNumbers)}</td><td class="num">${bl.totalPackages}</td><td>${esc(bl.cargoDescription)}<br>${bl.references?.length ? `${up('Ref')}: ${esc(bl.references.join(' / '))}` : ''}<br>${up('Freight')} ${esc(bl.freightTerms)}</td><td class="num">${w(bl.totalGrossWeight, style)}</td></tr></tbody></table>`;

  let body: string;
  if (style === 'modern') {
    body = `<header><div><h1>${title}</h1>${esc(bl.carrier?.name)} · SCAC ${esc(bl.carrier?.scac)} · ${issuer} B/L</div><div class="meta"><b>B/L No.</b>${esc(bl.blNumber)}<br><b>Booking</b>${esc(bl.bookingNumber)}<br><b>Shipped on board</b>${date(bl.shippedOnBoardDate, style)}</div></header>
      <div class="cols"><div><span class="label">Shipper</span>${party(bl.shipper, style)}</div><div><span class="label">Consignee</span>${party(bl.consignee, style)}</div><div><span class="label">Notify party</span>${party(bl.notifyParty, style)}</div></div>
      <div class="cols">${route.map(([k, v]) => `<div><span class="label">${k}</span>${v}</div>`).join('')}</div>
      ${cargo}<br><table><thead>${cHead}</thead><tbody>${containers}</tbody></table>
      <div class="note">Issued at ${esc(bl.placeOfIssue)} on ${date(bl.dateOfIssue, style)}. Received in apparent good order and condition unless otherwise noted.</div>`;
  } else {
    body = `<h1>${up(title)}</h1>
      <table class="grid">
        <tr><td class="box"><span class="label">${up('Shipper')}</span>${party(bl.shipper, style)}</td><td class="box">${up('B/L No.')}: <strong>${esc(bl.blNumber)}</strong><br>${up('Booking No.')}: ${esc(bl.bookingNumber)}<br>${up('Carrier')}: ${esc(up(bl.carrier?.name ?? ''))} (${esc(bl.carrier?.scac)})<br>${up(issuer)} B/L</td></tr>
        <tr><td class="box"><span class="label">${up('Consignee')}</span>${party(bl.consignee, style)}</td><td class="box"><span class="label">${up('Notify Party')}</span>${party(bl.notifyParty, style)}</td></tr>
        ${route.map(([k, v], i) => (i % 2 === 0 ? `<tr><td class="box"><span class="label">${k}</span>${v}</td>` : `<td class="box"><span class="label">${k}</span>${v}</td></tr>`)).join('')}<td class="box"></td></tr>
      </table><br>${cargo}<br><table><thead>${cHead}</thead><tbody>${containers}</tbody></table>
      <p>${up('Shipped on board')}: ${date(bl.shippedOnBoardDate, style)} &nbsp; ${up('Place and date of issue')}: ${esc(up(bl.placeOfIssue ?? ''))} ${date(bl.dateOfIssue, style)}</p>`;
  }
  return page(`${title} ${bl.blNumber}`, style, body);
}
