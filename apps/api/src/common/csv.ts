/** A CSV column: its header and how to read the cell from a row. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | undefined | null;
}

/** Byte order mark: without it Excel reads UTF-8 as the local code page and mangles accents. */
const BOM = '﻿';
/** A plain decimal: never a formula, so a negative amount keeps its sign. */
const NUMBER = /^-?\d+(\.\d+)?$/;
/** First characters a spreadsheet may run as a formula. */
const FORMULA = /^[=+\-@\t\r]/;

/** One cell, neutralized against formula injection and quoted when it holds a quote, comma or line break. */
export function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (FORMULA.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV (CRLF line ends) with a header row, prefixed with a UTF-8 BOM. */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const line = (cells: (string | number | undefined | null)[]) => cells.map(csvCell).join(',');
  return BOM + [line(columns.map((c) => c.header)), ...rows.map((r) => line(columns.map((c) => c.value(r))))].join('\r\n') + '\r\n';
}

/** `attachment; filename="<prefix>-YYYY-MM-DD.csv"`, dated today (UTC). */
export const csvAttachment = (prefix: string, now = new Date()) => `attachment; filename="${prefix}-${now.toISOString().slice(0, 10)}.csv"`;
