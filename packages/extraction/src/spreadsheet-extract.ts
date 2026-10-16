import { z } from 'zod';
import { report, withStage, type CommercialInvoice, type DocumentType, type ExtractionDetail, type PackingList, type ProgressCallback } from '@doccheck/schemas';
import { classifyDocument } from './classify';
import type { ExtractionResult } from './extract';
import type { LlmClient, Usage } from './llm';
import { countryCode, normalizeInvoice, normalizePackingList } from './normalize';
import type { RawInvoice, RawPackingList, RawParty, RawWeight } from './raw-schemas';
import { cellRef, sheetsToText, type Sheet } from './spreadsheet';
import { pdfPages } from './split';

/**
 * A packing list or invoice kept as a spreadsheet, read without a model: the header row of the line
 * table is found by its vocabulary, each column is mapped to a field, labelled cells above and below
 * the table give the document's own fields, and the result is the same "raw" document the model
 * returns for a PDF, which normalize.ts turns into the canonical one. The model is asked only one
 * thing, and only when the vocabulary is not enough: which field a header names. It sees the header
 * texts, never a value.
 */

export const SHEET_PROMPT_VERSION = 'sheet-headers-v1';

export type InvoiceColumn = 'lineNo' | 'sku' | 'description' | 'quantity' | 'unit' | 'unitPrice' | 'lineTotal' | 'countryOfOrigin' | 'hsCode';
export type PackingColumn = 'range' | 'count' | 'packageType' | 'sku' | 'description' | 'quantity' | 'unit' | 'netWeight' | 'grossWeight' | 'dimensions' | 'volume';
type Column = InvoiceColumn | PackingColumn;

/** Header vocabulary per field, most specific first: "Unit price" is a price before "price" alone is a total. */
const INVOICE_COLUMNS: [InvoiceColumn, RegExp][] = [
  ['unitPrice', /\b(unit ?price|u\/p|price ?\/ ?unit|price per unit|prix unitaire|precio unitario|unit cost|rate)\b/i],
  ['lineTotal', /\b(amount|line total|total( value| price| amount)?|extended|ext\.? price|montant|importe|value)\b/i],
  ['hsCode', /\b(hs|hts|h\.s\.|tariff|harmoni[sz]ed|commodity code)\b/i],
  ['countryOfOrigin', /\b(origin|coo|made in|pays d'origine)\b/i],
  ['sku', /\b(sku|item code|part ?(no|number|#)|article|style|model|ref(erence)?|code)\b/i],
  ['description', /\b(description|goods|product|item description|désignation|designation|descripción|commodity)\b/i],
  ['quantity', /\b(qty|quantity|quantité|cantidad|pcs)\b/i],
  ['unit', /\b(unit|uom|u\/m|unité|unidad)\b/i],
  ['lineNo', /^(no\.?|#|item|line|ln|n°|pos\.?)$/i],
];
const PACKING_COLUMNS: [PackingColumn, RegExp][] = [
  ['range', /\b(c\/no|carton (no|nos|numbers?)|ctn ?no|pkg ?no|package (no|nos|numbers?)|case no|box no|from ?- ?to)\b/i],
  ['count', /\b(no\.? of (cartons|ctns|packages|pkgs|cases)|cartons|ctns|packages|pkgs|cases|colis)\b/i],
  ['packageType', /\b(package type|pkg type|kind of packages?|packing|type)\b/i],
  ['netWeight', /\b(n\.? ?w\.?|net (weight|wt)|poids net)\b/i],
  ['grossWeight', /\b(g\.? ?w\.?|gross (weight|wt)|poids brut)\b/i],
  ['dimensions', /\b(dimensions?|meas(urement)?s?|l ?x ?w ?x ?h|size \(cm\))\b/i],
  ['volume', /\b(cbm|m3|m³|volume)\b/i],
  ['sku', /\b(sku|item code|part ?(no|number|#)|article|style|model|code)\b/i],
  ['description', /\b(description|goods|product|contents|désignation|descripción)\b/i],
  ['quantity', /\b(qty|quantity|quantité|cantidad|pcs|units)\b/i],
  ['unit', /\b(unit|uom|u\/m|unité)\b/i],
];
const REQUIRED: Record<'COMMERCIAL_INVOICE' | 'PACKING_LIST', Column[]> = {
  COMMERCIAL_INVOICE: ['description', 'quantity', 'unitPrice', 'lineTotal'],
  PACKING_LIST: ['count', 'description', 'quantity'],
};

/** Labelled cells outside the table, per raw field. */
const INVOICE_LABELS: [keyof RawInvoice | 'seller' | 'buyer' | 'consignee', RegExp][] = [
  ['invoiceNumber', /^(commercial )?invoice ?(no\.?|number|#|n°)|^n° (de )?facture/i],
  ['invoiceDate', /^(invoice )?date( of invoice)?$|^date de facture/i],
  ['poNumber', /^(p\.?o\.?|purchase order|order) ?(no\.?|number|#)?$/i],
  ['shipmentDate', /^(date of shipment|shipment date|ship date|shipped on|date of direct shipment)/i],
  ['transportMode', /^(mode( of transport)?|ship via|transport(ation)?( mode)?|shipped by)$/i],
  ['incotermCode', /^(terms of sale|incoterms?( 2020)?|terms of delivery|delivery terms|conditions of sale)$/i],
  ['paymentTerms', /^(payment( terms)?|terms of payment)$/i],
  ['currency', /^(currency|devise|moneda)$/i],
  ['countryOfOrigin', /^(country of origin|origin|made in)$/i],
  ['totalPackages', /^(total )?(packages|pkgs|cartons|ctns|no\.? of packages|number of packages)$/i],
  ['invoiceTotal', /^(invoice total|total invoice value|grand total|total amount|total)$/i],
  ['seller', /^(seller|vendor|shipper|exporter|sold by|from|supplier)\b/i],
  ['buyer', /^(buyer|sold to|purchaser|bill to|customer)\b/i],
  ['consignee', /^(consignee|ship to|deliver to|delivery address)\b/i],
];
const PACKING_LABELS: [keyof RawPackingList | 'seller' | 'consignee', RegExp][] = [
  ['packingListNumber', /^(packing list|p\/l) ?(no\.?|number|#)/i],
  ['invoiceRef', /^(invoice|inv\.?) ?(no\.?|number|#|ref)/i],
  ['marks', /^(shipping )?marks( (and|&) numbers)?$/i],
  ['seller', /^(seller|shipper|exporter|from|supplier)\b/i],
  ['consignee', /^(consignee|ship to|buyer|deliver to)\b/i],
];

const strip = (s: string) => s.replace(/[:：]\s*$/, '').trim();
const isLabel = (s: string, labels: [string, RegExp][]) => labels.some(([, re]) => re.test(strip(s)));

export interface Table {
  sheet: number;
  headerRow: number;
  /** Column index -> field. */
  columns: Map<number, Column>;
  rows: number[];
  totalsRow?: number;
  /** Headers mapped by the model (the rest by vocabulary). */
  byModel: string[];
}

/** Fields named by each header cell; a field taken by an earlier column is not reused. */
function mapHeaders(headers: string[], vocabulary: [Column, RegExp][]): Map<number, Column> {
  const map = new Map<number, Column>();
  const taken = new Set<Column>();
  for (const [field, re] of vocabulary) {
    const col = headers.findIndex((h, i) => h && !map.has(i) && re.test(h));
    if (col >= 0 && !taken.has(field)) {
      map.set(col, field);
      taken.add(field);
    }
  }
  return map;
}

/** The row with the most fields named, among the first 60 rows; at least two. */
function findTable(sheet: Sheet, sheetIndex: number, vocabulary: [Column, RegExp][]): Table | undefined {
  let best: { row: number; columns: Map<number, Column> } | undefined;
  sheet.rows.slice(0, 60).forEach((r, i) => {
    const columns = mapHeaders(r, vocabulary);
    if (columns.size >= 2 && columns.size > (best?.columns.size ?? 0)) best = { row: i, columns };
  });
  if (!best) return undefined;
  const rows: number[] = [];
  let totalsRow: number | undefined;
  for (let i = best.row + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] ?? [];
    if (r.every((c) => !c)) {
      if (rows.length) break;
      continue;
    }
    if (r.some((c) => /^(sub)?total\b|^grand total\b|^totals?:?$/i.test(c))) {
      totalsRow = i;
      break;
    }
    rows.push(i);
  }
  return { sheet: sheetIndex, headerRow: best.row, columns: best.columns, rows, totalsRow, byModel: [] };
}

const MappingAnswer = z.object({ columns: z.array(z.object({ header: z.string(), field: z.string() })) });

/** Asks the model which field each unmapped header names. Only the header texts are sent. */
async function mapWithModel(table: Table, sheet: Sheet, type: 'COMMERCIAL_INVOICE' | 'PACKING_LIST', llm: LlmClient): Promise<{ usage?: Usage; cached: boolean }> {
  const vocabulary = type === 'COMMERCIAL_INVOICE' ? INVOICE_COLUMNS : PACKING_COLUMNS;
  const headers = sheet.rows[table.headerRow] ?? [];
  const open = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => h && !table.columns.has(i));
  const missing = vocabulary.map(([f]) => f).filter((f) => ![...table.columns.values()].includes(f));
  if (!open.length || !missing.length) return { cached: false };
  const { output, usage, cached } = await llm.call(SHEET_PROMPT_VERSION, {
    system: `You map the column headers of a ${type === 'COMMERCIAL_INVOICE' ? 'commercial invoice' : 'packing list'} spreadsheet to fields.
Fields: ${missing.join(', ')}. For each header, answer the field it names, or "none" if it names none of them. Use each field at most once.`,
    user: JSON.stringify(open.map(({ h }) => h)),
    schema: MappingAnswer,
  });
  for (const { header, field } of output.columns) {
    const col = open.find(({ h }) => h === header)?.i;
    if (col === undefined || !missing.includes(field as Column) || [...table.columns.values()].includes(field as Column)) continue;
    table.columns.set(col, field as Column);
    table.byModel.push(header);
  }
  return { usage, cached };
}

/** The value next to a label: the next filled cell to its right (within three columns), or the cell below. */
function labelled(sheet: Sheet, re: RegExp, skip: Set<number>, labels: [string, RegExp][]): string | null {
  for (let i = 0; i < sheet.rows.length; i++) {
    if (skip.has(i)) continue;
    const r = sheet.rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const cell = r[j];
      if (!cell) continue;
      // "Invoice No.: INV-1" in one cell.
      const inline = cell.match(/^([^:：]{2,40})[:：]\s*(.+)$/);
      if (inline && re.test(strip(inline[1]))) return inline[2].trim();
      if (!re.test(strip(cell))) continue;
      for (let k = j + 1; k <= j + 3 && k < r.length; k++) if (r[k]) return isLabel(r[k], labels) ? null : r[k];
      const below = sheet.rows[i + 1]?.[j];
      if (below && !isLabel(below, labels)) return below;
    }
  }
  return null;
}

/** A party written as a block of cells under (or right of) its label: name, street lines, locality, country. */
function partyBlock(sheet: Sheet, re: RegExp, skip: Set<number>, labels: [string, RegExp][]): RawParty | null {
  for (let i = 0; i < sheet.rows.length; i++) {
    if (skip.has(i)) continue;
    const r = sheet.rows[i] ?? [];
    for (let j = 0; j < r.length; j++) {
      const cell = r[j];
      if (!cell || !re.test(strip(cell.replace(/[:：].*$/, '')))) continue;
      const inline = cell.match(/^[^:：]+[:：]\s*(.+)$/)?.[1];
      const col = inline ? j : r[j + 1] ? j + 1 : j;
      const lines: string[] = inline ? [inline] : col !== j ? [r[col]] : [];
      for (let k = i + 1; k < sheet.rows.length && lines.length < 7; k++) {
        const v = sheet.rows[k]?.[col];
        if (!v || skip.has(k) || isLabel(v, labels)) break;
        lines.push(v);
      }
      if (lines.length) return partyFromLines(lines);
    }
  }
  return null;
}

/** "Maple Retail Inc." / "100 King St W" / "Toronto, ON M5H 1A1" / "Canada" -> RawParty. */
export function partyFromLines(lines: string[]): RawParty {
  const rest = lines.slice(1).map((l) => l.trim()).filter(Boolean);
  let taxId: string | null = null;
  const tax = rest.findIndex((l) => /^(tax ?id|vat|ein|bn|gst|rfc|uscc)\b/i.test(l));
  if (tax >= 0) taxId = rest.splice(tax, 1)[0].replace(/^[^:]*:\s*/, '');
  let country: string | null = null;
  if (rest.length && countryCode(rest[rest.length - 1])) country = rest.pop()!;
  let city: string | null = null;
  let region: string | null = null;
  let postalCode: string | null = null;
  const locality = rest.length > 1 ? rest.length - 1 : -1;
  const m = locality >= 0 ? rest[locality].match(/^([^,\d]+?),\s*(?:([A-Z]{2,3})\b)?\s*,?\s*([A-Z0-9][A-Z0-9 -]{2,9})?$/) : null;
  if (m) {
    city = m[1].trim();
    region = m[2] ?? null;
    postalCode = m[3]?.trim() ?? null;
    rest.splice(locality, 1);
  }
  return { name: lines[0]?.trim() || null, addressLines: rest, city, region, postalCode, country, taxId };
}

/** "Gross weight (LBS)" -> LB; KG otherwise when the header says kilograms or nothing. */
const headerUnit = (header: string): string | null => (/\b(lbs?|pounds?)\b/i.test(header) ? 'LB' : /\b(kgs?|kilos?)\b/i.test(header) ? 'KG' : null);
const headerCurrency = (header: string): string | null => header.match(/\b(USD|CAD|EUR|CNY|RMB|GBP|JPY|MXN|INR|VND)\b/)?.[1] ?? null;

function invoiceFromSheet(sheet: Sheet, table: Table): RawInvoice {
  const labels = INVOICE_LABELS as [string, RegExp][];
  const skip = new Set([table.headerRow, ...table.rows]);
  const get = (field: string) => labelled(sheet, INVOICE_LABELS.find(([f]) => f === field)![1], skip, labels);
  const party = (field: string) => partyBlock(sheet, INVOICE_LABELS.find(([f]) => f === field)![1], skip, labels);
  const header = sheet.rows[table.headerRow];
  const colOf = (f: Column) => [...table.columns].find(([, v]) => v === f)?.[0];
  const cell = (row: number, f: Column) => {
    const c = colOf(f);
    return c === undefined ? null : sheet.rows[row]?.[c] || null;
  };
  const currency = get('currency') ?? headerCurrency(header[colOf('lineTotal') ?? -1] ?? '') ?? headerCurrency(header[colOf('unitPrice') ?? -1] ?? '');
  const incoterm = get('incotermCode');
  const totals = table.totalsRow;
  const emptyParty: RawParty = { name: null, addressLines: [], city: null, region: null, postalCode: null, country: null, taxId: null };
  return {
    invoiceNumber: get('invoiceNumber'),
    invoiceDate: get('invoiceDate'),
    poNumber: get('poNumber'),
    seller: party('seller') ?? emptyParty,
    buyer: party('buyer') ?? emptyParty,
    consignee: party('consignee'),
    shipmentDate: get('shipmentDate'),
    transportMode: get('transportMode'),
    placeOfShipment: null,
    portOfEntry: null,
    incotermCode: incoterm?.match(/\b[A-Z]{3}\b/)?.[0] ?? null,
    incotermPlace: incoterm?.replace(/^\s*[A-Z]{3}\b\s*/, '') || null,
    paymentTerms: get('paymentTerms'),
    currency,
    countryOfOrigin: get('countryOfOrigin'),
    lines: table.rows.map((r) => ({
      lineNo: cell(r, 'lineNo'),
      sku: cell(r, 'sku'),
      description: cell(r, 'description'),
      quantity: cell(r, 'quantity'),
      unit: cell(r, 'unit'),
      unitPrice: cell(r, 'unitPrice'),
      unitPriceCurrency: null,
      lineTotal: cell(r, 'lineTotal'),
      lineTotalCurrency: null,
      countryOfOrigin: cell(r, 'countryOfOrigin'),
      hsCode: cell(r, 'hsCode'),
    })),
    totalPackages: get('totalPackages'),
    grossWeight: weightLabel(sheet, /^(total )?gross (weight|wt)/i, skip, labels),
    netWeight: weightLabel(sheet, /^(total )?net (weight|wt)/i, skip, labels),
    invoiceTotal: (totals !== undefined ? cell(totals, 'lineTotal') : null) ?? get('invoiceTotal'),
    invoiceTotalCurrency: null,
    charges: [],
  };
}

function weightLabel(sheet: Sheet, re: RegExp, skip: Set<number>, labels: [string, RegExp][]): RawWeight | null {
  const v = labelled(sheet, re, skip, labels);
  if (!v) return null;
  const unit = v.match(/\b(kgs?|lbs?|t|mt)\b/i)?.[1] ?? null;
  return { value: v, unit };
}

function packingListFromSheet(sheet: Sheet, table: Table): RawPackingList {
  const labels = PACKING_LABELS as [string, RegExp][];
  const skip = new Set([table.headerRow, ...table.rows]);
  const get = (field: string) => labelled(sheet, PACKING_LABELS.find(([f]) => f === field)![1], skip, labels);
  const party = (field: string) => partyBlock(sheet, PACKING_LABELS.find(([f]) => f === field)![1], skip, labels);
  const header = sheet.rows[table.headerRow];
  const colOf = (f: Column) => [...table.columns].find(([, v]) => v === f)?.[0];
  const cell = (row: number | undefined, f: Column) => {
    const c = colOf(f);
    return c === undefined || row === undefined ? null : sheet.rows[row]?.[c] || null;
  };
  const w = (row: number | undefined, f: 'netWeight' | 'grossWeight'): RawWeight | null => {
    const v = cell(row, f);
    return v ? { value: v, unit: headerUnit(header[colOf(f)!] ?? '') ?? v.match(/\b(kgs?|lbs?)\b/i)?.[1] ?? null } : null;
  };
  const t = table.totalsRow;
  return {
    packingListNumber: get('packingListNumber'),
    invoiceRef: get('invoiceRef'),
    seller: party('seller'),
    consignee: party('consignee'),
    marks: get('marks'),
    packages: table.rows.map((r) => ({
      range: cell(r, 'range'),
      count: cell(r, 'count'),
      packageType: cell(r, 'packageType'),
      sku: cell(r, 'sku'),
      description: cell(r, 'description'),
      quantity: cell(r, 'quantity'),
      unit: cell(r, 'unit'),
      netWeight: w(r, 'netWeight'),
      grossWeight: w(r, 'grossWeight'),
      dimensionsCm: cell(r, 'dimensions'),
    })),
    totalPackages: cell(t, 'count'),
    totalNetWeight: w(t, 'netWeight'),
    totalGrossWeight: w(t, 'grossWeight'),
    totalVolumeM3: cell(t, 'volume'),
  };
}

export interface SheetExtractOptions {
  onProgress?: ProgressCallback<ExtractionDetail>;
  /** Asked only when the header vocabulary leaves a required column unmapped. Without it, those columns stay empty. */
  llm?: LlmClient;
  /** Sheets (1-based) that hold this document, when the workbook holds several; citations keep the workbook's numbering. */
  pages?: readonly number[];
}

/**
 * Sheets -> classified, extracted and normalized document, with the same result shape as a PDF's
 * extraction (`pdf` is the grid laid out as text, its lines carrying their cells). `type` skips
 * classification. The first sheet with a line table is the document.
 */
export async function extractSheets(sheets: Sheet[], type: DocumentType | undefined, { onProgress, llm, pages }: SheetExtractOptions = {}): Promise<ExtractionResult & { table?: Omit<Table, 'columns'> & { columns: Record<string, string> } }> {
  const all = sheetsToText(sheets);
  const pdf = pages?.length ? pdfPages(all, pages) : all;
  await report(onProgress, { stage: 'reading', status: 'done', durationMs: 0, detail: { pages: pdf.pageCount } });
  let detected: { type: DocumentType; confidence: number };
  if (type) {
    detected = { type, confidence: 1 };
    await report(onProgress, { stage: 'classifying', status: 'skipped', detail: { reason: 'type-given', documentType: type, confidence: 1 } });
  } else {
    detected = await withStage(onProgress, 'classifying', async () => classifyDocument(pdf.text), (d) => ({ documentType: d.type, confidence: d.confidence }));
  }
  if (detected.type !== 'COMMERCIAL_INVOICE' && detected.type !== 'PACKING_LIST') {
    return { documentType: detected.type, typeConfidence: detected.confidence, pdf, raw: null, data: null, issues: [`A spreadsheet is read as an invoice or a packing list, not as ${detected.type}`], cached: false };
  }
  const docType = detected.type;
  const vocabulary = docType === 'COMMERCIAL_INVOICE' ? INVOICE_COLUMNS : PACKING_COLUMNS;
  let table: Table | undefined;
  let sheet: Sheet | undefined;
  for (const [i, s] of sheets.entries()) {
    if (pages?.length && !pages.includes(i + 1)) continue;
    table = findTable(s, i, vocabulary);
    if (table) {
      sheet = s;
      break;
    }
  }
  if (!table || !sheet) {
    return { documentType: docType, typeConfidence: detected.confidence, pdf, raw: null, data: null, issues: ['No line table found: no row of the sheet reads as the column headers of the lines'], cached: false };
  }
  const t = table;
  const s = sheet;
  let usage: Usage | undefined;
  let cached = false;
  const missing = () => REQUIRED[docType].filter((f) => ![...t.columns.values()].includes(f));
  const raw = await withStage(
    onProgress,
    'extracting',
    async () => {
      if (missing().length && llm) ({ usage, cached } = await mapWithModel(t, s, docType, llm));
      return docType === 'COMMERCIAL_INVOICE' ? invoiceFromSheet(s, t) : packingListFromSheet(s, t);
    },
    () => ({ model: t.byModel.length ? llm?.provider.id : 'spreadsheet', documentType: docType, cached, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens }),
    { model: 'spreadsheet', documentType: docType },
  );
  const result = await withStage(
    onProgress,
    'normalizing',
    async () => (docType === 'COMMERCIAL_INVOICE' ? normalizeInvoice(raw as RawInvoice) : normalizePackingList(raw as RawPackingList)),
    (r) => ({ normalized: r.data !== null, issues: r.issues.length }),
  );
  const issues = [...result.issues];
  if (missing().length) issues.unshift(`No column for ${missing().join(', ')} in the header row (sheet "${s.name}", row ${t.headerRow + 1})`);
  if (t.byModel.length) issues.push(`Columns mapped by the model from their header: ${t.byModel.map((h) => `"${h}"`).join(', ')}`);
  const header = s.rows[t.headerRow];
  const columns = Object.fromEntries([...t.columns].map(([c, f]) => [cellRef(t.headerRow, c).replace(/\d+$/, ''), `${f} (${header[c]})`]));
  return {
    documentType: docType,
    typeConfidence: detected.confidence,
    pdf,
    raw,
    data: result.data as CommercialInvoice | PackingList | null,
    partial: result.partial,
    issues,
    usage,
    cached,
    table: { sheet: t.sheet, headerRow: t.headerRow, rows: t.rows, totalsRow: t.totalsRow, byModel: t.byModel, columns },
  };
}
