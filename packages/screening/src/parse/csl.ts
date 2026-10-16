import { countryCode } from '../text';
import type { EntryAddress, EntryType, ListEntry } from '../types';
import { clipText, uniq } from './formats';

/** Lists of the trade.gov Consolidated Screening List kept here, by the start of their `source`. */
export const CSL_LISTS: Record<string, string> = {
  'Entity List (EL)': 'bis-el',
  'Denied Persons List (DPL)': 'bis-dpl',
  'Unverified List (UVL)': 'bis-uvl',
  'Military End User (MEU)': 'bis-meu',
};

interface CslRecord {
  id?: string;
  source?: string;
  name?: string;
  alt_names?: string[] | null;
  type?: string | null;
  addresses?: { address?: string; city?: string; state?: string; postal_code?: string; country?: string }[] | null;
  programs?: string[] | null;
  start_date?: string | null;
  license_policy?: string | null;
  license_requirement?: string | null;
  remarks?: string | null;
  federal_register_notice?: string | null;
  source_list_url?: string | null;
}

/**
 * The BIS lists out of trade.gov's Consolidated Screening List JSON (`{ results: [...] }`). OFAC
 * lists in it are skipped: they come from OFAC's own files. Returns entries grouped by list id.
 */
export function parseCsl(json: string): Map<string, ListEntry[]> {
  const parsed = JSON.parse(json) as { results?: CslRecord[] };
  const out = new Map<string, ListEntry[]>(Object.values(CSL_LISTS).map((id) => [id, []]));
  for (const r of parsed.results ?? []) {
    const key = Object.keys(CSL_LISTS).find((k) => r.source?.startsWith(k));
    const name = r.name?.trim();
    if (!key || !name || !r.id) continue;
    const list = CSL_LISTS[key];
    const addresses: EntryAddress[] = (r.addresses ?? []).flatMap((a) => {
      const text = [a.address, a.city, a.state, a.postal_code, a.country].map((s) => s?.trim()).filter(Boolean).join(', ');
      if (!text) return [];
      const country = countryCode(a.country);
      return [{ text, ...(a.city?.trim() ? { city: a.city.trim() } : {}), ...(country ? { country } : {}) }];
    });
    const type: EntryType = r.type === 'Individual' ? 'individual' : r.type === 'Vessel' ? 'vessel' : 'entity';
    const remarks = [r.license_policy, r.license_requirement, r.remarks, r.federal_register_notice].map((s) => s?.trim()).filter(Boolean).join(' · ');
    out.get(list)!.push({
      id: r.id,
      list,
      name,
      aliases: uniq((r.alt_names ?? []).map((a) => a.trim()).filter((a) => a && a !== name)),
      type,
      countries: uniq(addresses.flatMap((a) => (a.country ? [a.country] : []))),
      addresses,
      programs: r.programs ?? [],
      ...(clipText(remarks) ? { remarks: clipText(remarks) } : {}),
      ...(r.source_list_url ? { url: r.source_list_url } : {}),
      ...(r.start_date ? { listedOn: r.start_date.slice(0, 10) } : {}),
    });
  }
  return out;
}
