import type { EntryAddress, EntryType, ListEntry } from '../types';
import { isoDate, parseCsv, uniq } from './formats';

/**
 * EU Consolidated List of persons, groups and entities subject to financial sanctions (the FSF
 * CSV, semicolon separated). The file has one row per combination of name, address, birth date
 * and document of an entity, so rows are grouped by Entity_LogicalId.
 */
export function parseEu(csv: string): { entries: ListEntry[]; versionDate?: string } {
  const [header, ...rows] = parseCsv(csv, ';');
  if (!header) return { entries: [] };
  const col = (name: string) => header.indexOf(name);
  const c = {
    date: col('fileGenerationDate'),
    id: col('Entity_LogicalId'),
    ref: col('Entity_EU_ReferenceNumber'),
    type: col('Entity_SubjectType_ClassificationCode'),
    programme: col('Entity_Regulation_Programme'),
    designated: col('Entity_DesignationDate'),
    remark: col('Entity_Remark'),
    name: col('NameAlias_WholeName'),
    city: col('Address_City'),
    street: col('Address_Street'),
    zip: col('Address_ZipCode'),
    country: col('Address_CountryIso2Code'),
    countryName: col('Address_CountryDescription'),
    citizenship: col('Citizenship_CountryIso2Code'),
  };
  const get = (row: string[], i: number) => (i >= 0 ? row[i]?.trim() || undefined : undefined);
  type Acc = { names: string[]; addresses: Map<string, EntryAddress>; countries: Set<string>; programmes: Set<string>; row: string[] };
  const byId = new Map<string, Acc>();
  let versionDate: string | undefined;
  for (const row of rows) {
    const id = get(row, c.id);
    if (!id) continue;
    versionDate ??= isoDate(get(row, c.date));
    const acc: Acc = byId.get(id) ?? { names: [], addresses: new Map(), countries: new Set(), programmes: new Set(), row };
    byId.set(id, acc);
    const name = get(row, c.name);
    if (name && !acc.names.includes(name)) acc.names.push(name);
    const country = get(row, c.country);
    const iso = country && /^[A-Z]{2}$/.test(country) && country !== '00' ? country : undefined;
    const text = [get(row, c.street), get(row, c.zip), get(row, c.city), get(row, c.countryName)].filter(Boolean).join(', ');
    if (text && !acc.addresses.has(text)) {
      const city = get(row, c.city);
      acc.addresses.set(text, { text, ...(city ? { city } : {}), ...(iso ? { country: iso } : {}) });
    }
    if (iso) acc.countries.add(iso);
    const citizenship = get(row, c.citizenship);
    if (citizenship && /^[A-Z]{2}$/.test(citizenship) && citizenship !== '00') acc.countries.add(citizenship);
    const programme = get(row, c.programme);
    if (programme) acc.programmes.add(programme);
  }
  const entries: ListEntry[] = [];
  for (const [id, acc] of byId) {
    const [name, ...aliases] = acc.names;
    if (!name) continue;
    const kind = get(acc.row, c.type);
    const type: EntryType = kind === 'person' ? 'individual' : kind === 'enterprise' ? 'entity' : 'unknown';
    const ref = get(acc.row, c.ref);
    const designated = isoDate(get(acc.row, c.designated));
    entries.push({
      id,
      list: 'eu-fsf',
      name,
      aliases: uniq(aliases),
      type,
      countries: [...acc.countries].sort(),
      addresses: [...acc.addresses.values()],
      programs: [...acc.programmes].sort(),
      ...(ref ? { remarks: `EU reference ${ref}` } : {}),
      url: 'https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions',
      ...(designated ? { listedOn: designated } : {}),
    });
  }
  return { entries, versionDate };
}
