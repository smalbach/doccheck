import { ScreeningIndex } from './matcher';
import { readLists } from './store';
import type { Manifest } from './types';

export interface LoadedScreening {
  index: ScreeningIndex;
  manifest: Manifest;
  /** Version date per list id. */
  versions: Record<string, string>;
}

/** Reads the cached lists in `dir` and indexes them. With no list cached, the index is empty. */
export async function loadScreening(dir: string): Promise<LoadedScreening> {
  const { manifest, entries } = await readLists(dir);
  const versions = Object.fromEntries(manifest.lists.filter((l) => l.versionDate).map((l) => [l.id, l.versionDate]));
  return { index: new ScreeningIndex(entries), manifest, versions };
}
