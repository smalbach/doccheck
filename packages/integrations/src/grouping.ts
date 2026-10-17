/**
 * Folder ingestion: which shipment a dropped file belongs to. Files that give the same reference
 * become one shipment (or are added to the account's shipment with that reference).
 *
 * - folder: the name of the folder the file is in, under the watched prefix: "SHP-1001/invoice.pdf".
 * - filename: the first capture group of `pattern` on the file name; by default everything before the
 *   first "_" or space: "SHP-1001_invoice.pdf", "SHP-1001 BL.pdf".
 */
export type GroupBy = 'folder' | 'filename';

export const DEFAULT_FILENAME_PATTERN = '^([A-Za-z0-9][A-Za-z0-9.-]*?)[_ ]';
const MAX_REFERENCE = 200;

/**
 * A user's pattern must have one capture group and no nested quantifier, the usual cause of
 * catastrophic backtracking ("(a+)+"). Returns the reason it is refused, or null.
 */
export function checkPattern(pattern: string): string | null {
  if (pattern.length > 200) return 'The pattern is longer than 200 characters';
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return `Not a valid regular expression: ${(err as Error).message}`;
  }
  if (new RegExp(`${re.source}|`).exec('')!.length < 2) return 'The pattern needs a capture group, (...), around the reference';
  if (/[+*}]\)*[+*{]/.test(pattern) || /\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return 'Nested repetition (like (a+)+) is not allowed';
  return null;
}

/** The reference a file is grouped by, or null when its path gives none. `path` is relative to the watched prefix, with "/" separators. */
export function referenceFor(path: string, groupBy: GroupBy, pattern = DEFAULT_FILENAME_PATTERN): string | null {
  const parts = path.split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  let ref: string | undefined;
  if (groupBy === 'folder') {
    ref = parts.length >= 2 ? parts.at(-2) : undefined;
  } else {
    const base = name.replace(/\.pdf$/i, '').slice(0, 255);
    ref = new RegExp(pattern).exec(base)?.[1];
  }
  const clean = ref?.trim().slice(0, MAX_REFERENCE);
  return clean ? clean : null;
}

/** Only PDFs are ingested; hidden files and files still being written by some tools (".part", "~") are not. */
export const isIngestible = (path: string) => {
  const name = path.split('/').at(-1) ?? '';
  return /\.pdf$/i.test(name) && !name.startsWith('.') && !name.startsWith('~');
};
