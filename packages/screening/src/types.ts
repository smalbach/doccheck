/** What a list entry designates. Freight parties are mostly entities; individuals and vessels are kept for completeness. */
export type EntryType = 'entity' | 'individual' | 'vessel' | 'aircraft' | 'unknown';

export interface EntryAddress {
  /** The address as the list prints it, one line. */
  text: string;
  city?: string;
  /** ISO 3166-1 alpha-2 when the list gives a country we recognize. */
  country?: string;
}

/** One designated party, normalized from any of the source lists. */
export interface ListEntry {
  /** Identifier within its list (OFAC ent_num, UN reference number, EU logical id...). */
  id: string;
  /** Id of the list it belongs to (see LISTS). */
  list: string;
  name: string;
  aliases: string[];
  type: EntryType;
  /** ISO alpha-2 countries from the entry's addresses, nationality or the list's country field. */
  countries: string[];
  addresses: EntryAddress[];
  /** Sanctions programs, regulation or schedule the entry is listed under. */
  programs: string[];
  /** Free text the list prints with the entry (remarks, license policy, listing date), cut short. */
  remarks?: string;
  /** Link to the entry or to the list page that shows it. */
  url?: string;
  /** Date the party was listed, when the list says (YYYY-MM-DD). */
  listedOn?: string;
}

/** A list as stored on disk: data/screening/lists/<id>.json. */
export interface ListFile {
  id: string;
  versionDate: string;
  entries: ListEntry[];
}

/** One list in the manifest: where it came from and which version is cached. */
export interface ListVersion {
  id: string;
  name: string;
  publisher: string;
  /** Page a person can open to see the list and its terms. */
  page: string;
  /** Files downloaded to build it. */
  downloads: string[];
  /** Date the publisher gives the version (generation or last-modified date), YYYY-MM-DD. */
  versionDate: string;
  /** When this server downloaded it (ISO 8601). */
  fetchedAt: string;
  /** SHA-256 of the downloaded files, in order, hashed together. */
  sha256: string;
  entries: number;
  /** The last refresh of this list failed: the version above is the previous one (or none). */
  lastError?: string;
  lastErrorAt?: string;
}

export interface Manifest {
  /** When the last refresh finished (ISO 8601). */
  refreshedAt?: string;
  lists: ListVersion[];
}

/** Scores that decide what a match becomes. */
export interface ScreeningThresholds {
  /** At or above: S1, the party is on a restricted list (HIGH). */
  match: number;
  /** At or above (and below `match`): S2, a possible match to review (MEDIUM). */
  review: number;
}

export const DEFAULT_THRESHOLDS: ScreeningThresholds = { match: 0.92, review: 0.82 };

/** A false positive a user set aside: this party name is not this list entry. */
export interface AllowlistEntry {
  /** Party name as normalized by partyKey(). */
  partyKey: string;
  list: string;
  entryId: string;
}
