import { countryCode } from '../text';
import type { EntryAddress, EntryType, ListEntry } from '../types';
import { clipText, parseCsv, uniq } from './formats';

/** OFAC's CSV writes "-0-" for an empty field. */
const value = (s: string | undefined) => {
  const t = s?.trim();
  return !t || t === '-0-' ? undefined : t;
};

const TYPES: Record<string, EntryType> = { individual: 'individual', vessel: 'vessel', aircraft: 'aircraft' };

/**
 * OFAC SDN or Consolidated (non-SDN) list, from its three legacy CSV files: primary records
 * (ent_num, name, type, program, ..., remarks), addresses (ent_num, add_num, address,
 * city/state/postal, country, remarks) and alternate names (ent_num, alt_num, type, name, remarks).
 */
export function parseOfac(list: string, files: { prim: string; add: string; alt: string }): ListEntry[] {
  const addresses = new Map<string, EntryAddress[]>();
  for (const [ent, , street, cityLine, country] of parseCsv(files.add)) {
    if (!value(ent)) continue;
    const text = [street, cityLine, country].map(value).filter(Boolean).join(', ');
    if (!text) continue;
    const code = countryCode(value(country));
    // "London EC3N 1DY", "Zurich CH-8022": the words without digits are the city.
    const city = value(cityLine)?.split(/[\s,]+/).filter((w) => w && !/\d/.test(w)).join(' ') || undefined;
    const list = addresses.get(ent.trim()) ?? [];
    list.push({ text, ...(city ? { city } : {}), ...(code ? { country: code } : {}) });
    addresses.set(ent.trim(), list);
  }
  const aliases = new Map<string, string[]>();
  for (const [ent, , , name] of parseCsv(files.alt)) {
    const n = value(name);
    if (!value(ent) || !n) continue;
    aliases.set(ent.trim(), [...(aliases.get(ent.trim()) ?? []), n]);
  }
  const entries: ListEntry[] = [];
  for (const [ent, name, type, program, , , , , , , , remarks] of parseCsv(files.prim)) {
    const id = value(ent);
    const n = value(name);
    if (!id || !n || !/^\d+$/.test(id)) continue;
    const addrs = addresses.get(id) ?? [];
    entries.push({
      id,
      list,
      name: n,
      aliases: uniq(aliases.get(id) ?? []).filter((a) => a !== n),
      type: TYPES[value(type)?.toLowerCase() ?? ''] ?? 'entity',
      countries: uniq(addrs.flatMap((a) => (a.country ? [a.country] : []))),
      addresses: addrs,
      programs: (value(program) ?? '').split(/\]\s*\[/).map((p) => p.replace(/[[\]]/g, '').trim()).filter(Boolean),
      ...(clipText(value(remarks)) ? { remarks: clipText(value(remarks)) } : {}),
      url: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${id}`,
    });
  }
  return entries;
}
