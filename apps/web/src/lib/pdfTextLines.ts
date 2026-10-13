/** [x0, y0, x1, y1] in PDF points, origin top-left (like the extraction's pdf lines). */
export type Box = [number, number, number, number];

/** A run of text as pdf.js reports it (often one word): baseline origin (x, y) in PDF points, origin bottom-left. */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line of a page: its runs, left to right, joined by single spaces into `text`. */
export interface PageLine {
  page: number;
  text: string;
  bbox: Box;
  /** Each run's place in `text` ([start, end)) and its box. */
  runs: { start: number; end: number; bbox: Box }[];
}

const union = (boxes: Box[]): Box => [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];

/** Lower case, whitespace collapsed: how lines and values are compared. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Groups a page's text runs into lines (same baseline, give or take half a line), top to bottom. */
export function groupLines(runs: TextRun[], page: number, pageHeight: number): PageLine[] {
  const sorted = runs.filter((r) => r.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextRun[][] = [];
  for (const r of sorted) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (row && first && Math.abs(first.y - r.y) <= Math.max(2, Math.min(first.height, r.height) / 2)) row.push(r);
    else rows.push([r]);
  }
  return rows.map((row) => {
    let text = '';
    const placed = row
      .sort((a, b) => a.x - b.x)
      .map((r) => {
        if (text) text += ' ';
        const start = text.length;
        text += norm(r.str);
        return { start, end: text.length, bbox: [r.x, pageHeight - r.y - r.height, r.x + r.width, pageHeight - r.y] as Box };
      });
    return { page, text, bbox: union(placed.map((r) => r.bbox)), runs: placed };
  });
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Index of `needle` in `hay` as whole words (not "kgs" inside "pkgs"), or -1. */
function wordIndex(hay: string, needle: string): number {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = hay.charAt(i - 1);
    const after = hay.charAt(i + needle.length);
    if (!(before && WORD_CHAR.test(before) && WORD_CHAR.test(needle.charAt(0))) && !(after && WORD_CHAR.test(after) && WORD_CHAR.test(needle.charAt(needle.length - 1)))) return i;
  }
  return -1;
}

/** Values this short (or with no letter or digit) match too many lines to point at one. */
const MIN_VALUE_LENGTH = 3;

/**
 * Where `value` is printed: the first line holding it as whole words, looking from line `from` on
 * (reading order: the model mostly writes values in the order they are printed), then from the top.
 * Returns the line's index and the box of the runs the value covers. undefined: not found.
 */
export function findValue(lines: PageLine[], value: string, from = 0): { index: number; page: number; bbox: Box } | undefined {
  const needle = norm(value);
  if (needle.length < MIN_VALUE_LENGTH || !WORD_CHAR.test(needle)) return undefined;
  const start = Math.min(Math.max(0, from), lines.length);
  const order = [...lines.keys()];
  for (const index of order.slice(start).concat(order.slice(0, start))) {
    const line = lines[index];
    const at = line ? wordIndex(line.text, needle) : -1;
    if (!line || at < 0) continue;
    const covered = line.runs.filter((r) => r.start < at + needle.length && r.end > at);
    return { index, page: line.page, bbox: covered.length ? union(covered.map((r) => r.bbox)) : line.bbox };
  }
  return undefined;
}
