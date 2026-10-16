/**
 * Just enough CSV, XML and HTML reading for the published list formats, without dependencies.
 * The inputs are files downloaded from government sites: treat them as data, never evaluate them.
 */

/** RFC 4180 CSV: quoted fields may hold the delimiter, quotes ("") and line breaks. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const escapeTag = (tag: string) => tag.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** Inner XML of every <tag>...</tag> (the tag must not nest inside itself, true of these formats). */
export function xmlElements(xml: string, tag: string): string[] {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

/** Text of every <tag>, decoded and trimmed, empty ones dropped. */
export function xmlTexts(xml: string, tag: string): string[] {
  return xmlElements(xml, tag)
    .map((inner) => decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export const xmlText = (xml: string, tag: string): string | undefined => xmlTexts(xml, tag)[0];

/** Visible text of an HTML fragment, on one line. */
export function htmlText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "15/10/2026" -> "2026-10-15"; "June 21, 2022" -> "2022-06-21"; ISO dates pass through. */
export function isoDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const mdy = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) {
    const m = months.findIndex((name) => name.startsWith(mdy[1].toLowerCase().slice(0, 3)));
    if (m >= 0) return `${mdy[3]}-${String(m + 1).padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  const http = Date.parse(t);
  return Number.isNaN(http) ? undefined : new Date(http).toISOString().slice(0, 10);
}

/** Remarks are shown with a finding, not stored whole. */
export const clipText = (s: string | undefined, max = 400): string | undefined => {
  const t = s?.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const uniq = <T>(items: Iterable<T>): T[] => [...new Set(items)];
