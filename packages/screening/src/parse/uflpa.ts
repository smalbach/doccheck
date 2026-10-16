import type { ListEntry } from '../types';
import { htmlText, isoDate, uniq } from './formats';

/**
 * "Hetian Haolin Hair Accessories Co. Ltd. (and two aliases: Hotan Haolin Hair Accessories; and
 * Hollin Hair Accessories)" -> name and aliases. The parenthesis may also say "also known as",
 * "formerly known as" or "including three aliases:", and may end with "and its subsidiaries".
 */
export function splitUflpaName(cell: string): { name: string; aliases: string[] } {
  const open = cell.indexOf('(');
  if (open < 0) return { name: cell.trim(), aliases: [] };
  const name = cell.slice(0, open).trim();
  const close = cell.lastIndexOf(')');
  const inner = cell.slice(open + 1, close > open ? close : undefined);
  const list = inner.includes(':') ? inner.slice(inner.indexOf(':') + 1) : inner.replace(/^.*?known as/i, '');
  const aliases = list
    .split(/;|,\s+and\s+(?=[A-Z])/)
    .map((a) => a.replace(/^\s*(and|or)\s+/i, '').replace(/\s+/g, ' ').trim())
    .filter((a) => a.length > 1 && !/^(and|its)\b/i.test(a));
  return { name, aliases: uniq(aliases).filter((a) => a !== name) };
}

/**
 * DHS UFLPA Entity List: the tables on dhs.gov/uflpa-entity-list (one per section of the list),
 * each row the entity's name, with its aliases in parentheses, and the effective date.
 */
export function parseUflpa(html: string): { entries: ListEntry[]; versionDate?: string } {
  const entries = new Map<string, ListEntry>();
  let latest: string | undefined;
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(htmlText);
      if (cells.length < 2 || !cells[0]) continue;
      const { name, aliases } = splitUflpaName(cells[0]);
      const listedOn = isoDate(cells[1]);
      if (!name || !listedOn) continue;
      if (!latest || listedOn > latest) latest = listedOn;
      const id = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
      const seen = entries.get(id);
      if (seen) {
        seen.aliases = uniq([...seen.aliases, ...aliases]);
        continue;
      }
      entries.set(id, {
        id,
        list: 'dhs-uflpa',
        name,
        aliases,
        type: 'entity',
        countries: ['CN'],
        addresses: [],
        programs: ['UFLPA'],
        url: 'https://www.dhs.gov/uflpa-entity-list',
        listedOn,
      });
    }
  }
  return { entries: [...entries.values()], versionDate: latest };
}
