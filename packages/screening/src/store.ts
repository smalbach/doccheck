import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LISTS, SOURCES, type Source } from './sources';
import type { ListEntry, ListFile, ListVersion, Manifest } from './types';

/**
 * Lists cached on disk, so screening works offline:
 *   <dir>/manifest.json        source, version date, checksum and size of each list
 *   <dir>/lists/<id>.json      the normalized entries ({ id, versionDate, entries })
 */
export async function readManifest(dir: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return { lists: [] };
  }
}

/** Every cached list's entries. Lists the manifest names but whose file is missing are skipped. */
export async function readLists(dir: string): Promise<{ manifest: Manifest; entries: ListEntry[] }> {
  const manifest = await readManifest(dir);
  const entries: ListEntry[] = [];
  for (const v of manifest.lists) {
    if (v.entries === 0 && !v.sha256) continue;
    try {
      const file = JSON.parse(await readFile(join(dir, 'lists', `${v.id}.json`), 'utf8')) as ListFile;
      entries.push(...file.entries);
    } catch {
      // A list that never downloaded has a manifest line with its error and no file.
    }
  }
  return { manifest, entries };
}

/** Writes through a temporary file, so a reader never sees half a list. */
async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

export type Fetcher = (url: string) => Promise<{ text: string; lastModified?: string }>;

/** Plain HTTPS GET with a long timeout (the EU file is about 25 MB and its server is slow). */
export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; DocCheck party screening)' }, signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return { text: await res.text(), lastModified: res.headers.get('last-modified') ?? undefined };
};

export interface RefreshOutcome {
  source: string;
  ok: boolean;
  lists: string[];
  error?: string;
}

/**
 * Downloads every source (or the ones named), parses it and replaces its lists on disk. A source
 * that fails keeps its previous version, and the manifest records the error. Sources run one after
 * the other so a slow one does not hold the others' memory at once.
 */
export async function refreshLists(dir: string, opts: { fetcher?: Fetcher; only?: string[]; now?: () => Date; onSource?: (o: RefreshOutcome) => void } = {}): Promise<{ manifest: Manifest; outcomes: RefreshOutcome[] }> {
  const fetcher = opts.fetcher ?? httpFetcher;
  const now = opts.now ?? (() => new Date());
  await mkdir(join(dir, 'lists'), { recursive: true });
  const manifest = await readManifest(dir);
  const outcomes: RefreshOutcome[] = [];
  const sources = SOURCES.filter((s) => !opts.only || opts.only.includes(s.id));
  for (const source of sources) {
    const outcome = await refreshSource(dir, source, manifest, fetcher, now);
    outcomes.push(outcome);
    opts.onSource?.(outcome);
  }
  manifest.refreshedAt = now().toISOString();
  manifest.lists.sort((a, b) => Object.keys(LISTS).indexOf(a.id) - Object.keys(LISTS).indexOf(b.id));
  await writeAtomic(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, outcomes };
}

async function refreshSource(dir: string, source: Source, manifest: Manifest, fetcher: Fetcher, now: () => Date): Promise<RefreshOutcome> {
  const fetchedAt = now().toISOString();
  try {
    const texts: Record<string, string> = {};
    const hash = createHash('sha256');
    let lastModified: string | undefined;
    for (const [name, url] of Object.entries(source.files)) {
      const got = await fetcher(url);
      texts[name] = got.text;
      hash.update(got.text);
      lastModified ??= got.lastModified;
    }
    const { lists, versionDate } = source.build(texts);
    const total = [...lists.values()].reduce((n, e) => n + e.length, 0);
    if (total === 0) throw new Error('no entries found: the format may have changed');
    const sha256 = hash.digest('hex');
    const version = versionDate ?? (lastModified ? new Date(lastModified).toISOString().slice(0, 10) : fetchedAt.slice(0, 10));
    for (const [id, entries] of lists) {
      const info = LISTS[id];
      const file: ListFile = { id, versionDate: version, entries };
      await writeAtomic(join(dir, 'lists', `${id}.json`), JSON.stringify(file));
      const v: ListVersion = { id, name: info.name, publisher: info.publisher, page: info.page, downloads: Object.values(source.files), versionDate: version, fetchedAt, sha256, entries: entries.length };
      upsert(manifest, v);
    }
    return { source: source.id, ok: true, lists: [...lists.keys()] };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const ids = Object.keys(LISTS).filter((id) => id === source.id || (source.id === 'trade-gov-csl' && id.startsWith('bis-')));
    for (const id of ids) {
      const previous = manifest.lists.find((l) => l.id === id);
      const info = LISTS[id];
      upsert(manifest, {
        ...(previous ?? { id, name: info.name, publisher: info.publisher, page: info.page, downloads: Object.values(source.files), versionDate: '', fetchedAt: '', sha256: '', entries: 0 }),
        lastError: error,
        lastErrorAt: fetchedAt,
      });
    }
    return { source: source.id, ok: false, lists: ids, error };
  }
}

function upsert(manifest: Manifest, v: ListVersion) {
  const i = manifest.lists.findIndex((l) => l.id === v.id);
  if (i >= 0) manifest.lists[i] = v;
  else manifest.lists.push(v);
}
