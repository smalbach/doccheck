import type { PdfText, TextLine } from './pdf-text';
import { readZip, writeZip } from './zip';

/**
 * Spreadsheets (.xlsx, .csv) read deterministically into a grid of cell texts. Numbers keep the
 * digits the cell stores, with the decimals its number format shows; dates come out as ISO dates.
 * The grid is then laid out like a PDF's text (one line per row, each cell with its A1 reference),
 * so classification, citations and the viewer work on it the same way.
 */

export interface Sheet {
  name: string;
  /** Cell texts by row and column, from A1; "" for an empty cell. */
  rows: string[][];
}

export type SpreadsheetFormat = 'xlsx' | 'csv';

/** By file name: .xlsx (or .xlsm), or .csv, .tsv, .txt text. Legacy binary .xls is not read. */
export function spreadsheetFormat(fileName: string, bytes?: Uint8Array): SpreadsheetFormat | undefined {
  const name = fileName.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return 'xlsx';
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return 'csv';
  return undefined;
}

/** A file stored as a spreadsheet: a ZIP is an .xlsx, anything else CSV text. */
export const storedSpreadsheetFormat = (bytes: Uint8Array): SpreadsheetFormat => (bytes[0] === 0x50 && bytes[1] === 0x4b ? 'xlsx' : 'csv');

/**
 * `format` overrides the file name's extension: a stored file is known to be a spreadsheet, and an
 * .xlsx is a ZIP. A CSV's one sheet is named after the file.
 */
export function readSpreadsheet(bytes: Uint8Array, fileName: string, format = spreadsheetFormat(fileName, bytes)): Sheet[] {
  if (format === 'xlsx') return readXlsx(bytes);
  if (format === 'csv') return [{ name: fileName.replace(/^.*[\\/]/, '').replace(/\s*\([^)]*\)$/, '').replace(/\.[^.]+$/, ''), rows: readCsv(new TextDecoder().decode(bytes)) }];
  throw new Error(`${fileName} is not an .xlsx or .csv spreadsheet`);
}

/** "C12" for row 11, column 2 (both from 0). */
export function cellRef(row: number, col: number): string {
  let letters = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 1}`;
}

/** "C12" -> [11, 2]. */
export function parseCellRef(ref: string): [row: number, col: number] {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Not a cell reference: ${ref}`);
  const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [Number(m[2]) - 1, col];
}

// ---- CSV -----------------------------------------------------------------------------------------

/** RFC 4180 with the delimiter guessed from the first line (comma, semicolon or tab); a BOM is dropped. */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

export function writeCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
}

// ---- XLSX ----------------------------------------------------------------------------------------

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );
const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
/** The text of every <t> in an element (rich text runs included), in order. */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unescapeXml(m[1] ?? '')).join('');

/** Built-in number formats that show dates (ECMA-376 18.8.30). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Days since 1899-12-30 (Excel's 1900 system, its leap-year bug included) -> ISO date. */
function serialToIso(serial: number): string {
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The stored number as a decimal string: at most 15 significant digits (what Excel shows; a float
 * written as 8.0999999999999996 reads 8.1), padded to the decimals of a fixed format ("0.00").
 */
export function numberText(v: string, decimals?: number): string {
  let t = v.trim();
  const digits = t.replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (/e/i.test(t) || digits.length > 15) t = String(Number(Number(t).toPrecision(15)));
  if (decimals === undefined) return t;
  const [int, frac = ''] = t.split('.');
  return frac.length >= decimals ? t : `${int}.${frac.padEnd(decimals, '0')}`;
}

interface Styles {
  /** Per cell style index: shows a date, and the fixed decimals of its number format. */
  xfs: { date: boolean; decimals?: number }[];
}

function readStyles(xml: string | undefined): Styles {
  if (!xml) return { xfs: [] };
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), unescapeXml(attr(m[0], 'formatCode') ?? ''));
  const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  const xfs = [...cellXfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    const code = custom.get(id) ?? (id === 2 || id === 4 ? '0.00' : '');
    const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    const date = DATE_FORMATS.has(id) || (/[dmy]/i.test(bare) && !/^[#0.,]+$/.test(bare));
    const decimals = bare.match(/\.(0+)/)?.[1].length;
    return { date, decimals };
  });
  return { xfs };
}

export function readXlsx(bytes: Uint8Array): Sheet[] {
  const zip = readZip(bytes);
  const file = (name: string) => zip.get(name)?.toString('utf8');
  const workbook = file('xl/workbook.xml');
  if (!workbook) throw new Error('Not an .xlsx workbook (no xl/workbook.xml)');
  const rels = new Map([...(file('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [...(file('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const styles = readStyles(file('xl/styles.xml'));
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`);
    const target = rels.get(attr(m[0], 'r:id'));
    const path = target?.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = target ? file(path) : undefined;
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowIndex = Number(attr(r[0], 'r') ?? rows.length + 1) - 1;
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1];
        const ref = attr(head, 'r');
        const [row, col] = ref ? parseCellRef(ref) : [rowIndex, (rows[rowIndex]?.length ?? 0)];
        const type = attr(head, 't');
        const style = styles.xfs[Number(attr(head, 's') ?? 0)];
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = '';
        if (type === 's' && v !== undefined) value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = texts(body);
        else if (type === 'str' || type === 'e') value = unescapeXml(v ?? '');
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) value = style?.date ? serialToIso(Number(v)) : numberText(v, style?.decimals);
        (rows[row] ??= [])[col] = value.trim();
      }
    }
    sheets.push({ name, rows: Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? '')) });
  }
  return sheets;
}

/**
 * A minimal .xlsx with the given sheets: strings as inline strings, cells that look like decimals
 * ("48600.00", "120") as numbers with a fixed format showing their decimals. For the synthetic set
 * and tests; real workbooks come from Excel and other tools.
 */
export function writeXlsx(sheets: Sheet[]): Buffer {
  const formats = new Map<number, number>(); // decimals -> style index
  const styleFor = (decimals: number) => {
    if (!formats.has(decimals)) formats.set(decimals, formats.size + 1);
    return formats.get(decimals)!;
  };
  const sheetXml = sheets.map((s) => {
    const rows = s.rows
      .map((r, i) => {
        const cells = r
          .map((v, j) => {
            if (v === '') return '';
            const ref = cellRef(i, j);
            const num = v.match(/^-?\d{1,15}(?:\.(\d{1,6}))?$/);
            if (num && !/^0\d/.test(v)) return `<c r="${ref}"${num[1] ? ` s="${styleFor(num[1].length)}"` : ''}><v>${v}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
          })
          .join('');
        return `<row r="${i + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  const numFmts = [...formats].map(([d], i) => `<numFmt numFmtId="${164 + i}" formatCode="0.${'0'.repeat(d)}"/>`).join('');
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>', ...[...formats].map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>`)].join('');
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${ns}><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts ? `<numFmts count="${formats.size}">${numFmts}</numFmts>` : ''}<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="${formats.size + 1}">${xfs}</cellXfs></styleSheet>`,
  };
  sheetXml.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = x));
  return writeZip(files);
}

// ---- Grid as text --------------------------------------------------------------------------------

/** Columns this many characters wide in the layout text (wide cells push the next one along). */
const COLUMN_CHARS = 14;

/**
 * The sheets as a PdfText: page = sheet (1-based), one line per non-empty row, cells padded to their
 * column. bbox is in cell units ([first column, row, last column + 1, row + 1]) and each line keeps
 * its cells, so a cited value can name its cell.
 */
export function sheetsToText(sheets: Sheet[]): PdfText {
  const lines: TextLine[] = [];
  const pages: string[] = [];
  sheets.forEach((sheet, s) => {
    const pageLines: string[] = [];
    sheet.rows.forEach((row, r) => {
      const cells = row.map((text, c) => ({ c, text })).filter((x) => x.text);
      if (!cells.length) return;
      let text = '';
      for (const { c, text: t } of cells) text = text.padEnd(Math.max(c * COLUMN_CHARS, text.length ? text.length + 2 : 0), ' ') + t;
      lines.push({ page: s + 1, text, bbox: [cells[0].c, r, cells[cells.length - 1].c + 1, r + 1], sheet: sheet.name, cells: cells.map(({ c, text: t }) => ({ ref: cellRef(r, c), text: t })) });
      pageLines.push(text);
    });
    pages.push(`--- sheet ${s + 1}: ${sheet.name} ---\n${pageLines.join('\n')}`);
  });
  return { pageCount: sheets.length, lines, text: pages.join('\n\n') };
}
