import { countryCode } from '../text';
import type { EntryAddress, ListEntry } from '../types';
import { clipText, isoDate, uniq, xmlElements, xmlText, xmlTexts } from './formats';

/** UN Security Council Consolidated List, XML: <INDIVIDUAL> and <ENTITY> records. */
export function parseUn(xml: string): { entries: ListEntry[]; versionDate?: string } {
  const versionDate = isoDate(xml.match(/dateGenerated="([^"]+)"/)?.[1]);
  const entries: ListEntry[] = [];
  for (const [tag, type] of [['INDIVIDUAL', 'individual'], ['ENTITY', 'entity']] as const) {
    for (const rec of xmlElements(xml, tag)) {
      const name = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((t) => xmlText(rec, t)).filter(Boolean).join(' ');
      const ref = xmlText(rec, 'REFERENCE_NUMBER') ?? xmlText(rec, 'DATAID');
      if (!name || !ref) continue;
      const aliases = xmlElements(rec, `${tag}_ALIAS`).flatMap((a) => xmlTexts(a, 'ALIAS_NAME'));
      const addresses: EntryAddress[] = xmlElements(rec, `${tag}_ADDRESS`).flatMap((a) => {
        const city = xmlText(a, 'CITY');
        const countryName = xmlText(a, 'COUNTRY');
        const text = [xmlText(a, 'STREET'), city, xmlText(a, 'STATE_PROVINCE'), countryName].filter(Boolean).join(', ');
        if (!text) return [];
        const country = countryCode(countryName);
        return [{ text, ...(city ? { city } : {}), ...(country ? { country } : {}) }];
      });
      const nationality = xmlElements(rec, 'NATIONALITY').flatMap((n) => xmlTexts(n, 'VALUE')).map(countryCode);
      const listed = isoDate(xmlText(rec, 'LISTED_ON'));
      entries.push({
        id: ref,
        list: 'un-sc',
        name,
        aliases: uniq(aliases).filter((a) => a !== name),
        type,
        countries: uniq([...addresses.flatMap((a) => (a.country ? [a.country] : [])), ...nationality.filter((c): c is string => !!c)]),
        addresses,
        programs: [xmlText(rec, 'UN_LIST_TYPE') ?? ''].filter(Boolean),
        ...(clipText(xmlText(rec, 'COMMENTS1')) ? { remarks: clipText(xmlText(rec, 'COMMENTS1')) } : {}),
        url: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list',
        ...(listed ? { listedOn: listed } : {}),
      });
    }
  }
  return { entries, versionDate };
}
