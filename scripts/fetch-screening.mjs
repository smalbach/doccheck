#!/usr/bin/env node
/**
 * Downloads the denied and restricted party lists and caches them, normalized, in data/screening
 * (manifest.json + lists/<id>.json), which is what the API screens against. Run it again to refresh;
 * admins can also refresh from Administration › Screening.
 *
 *   npm run screening:fetch                       # every list
 *   npm run screening:fetch -- --only un-sc,dhs-uflpa
 *   npm run screening:fetch -- --from <dir>       # parse files downloaded by hand instead
 *
 * With --from, each source file is read from <dir>/<source>-<file> (for example ofac-sdn-prim,
 * trade-gov-csl-csl, eu-fsf-csv). Sources: ofac-sdn, ofac-cons, trade-gov-csl (BIS Entity List,
 * Denied Persons, Unverified, Military End-User), ca-sema, un-sc, eu-fsf, dhs-uflpa.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { httpFetcher, refreshLists, SOURCES } from '@doccheck/screening';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: process.env.SCREENING_DIR ?? 'data/screening' },
    only: { type: 'string' },
    from: { type: 'string' },
  },
});
const dir = resolve(values.dir);
const only = values.only?.split(',').map((s) => s.trim()).filter(Boolean);

const byUrl = new Map(SOURCES.flatMap((s) => Object.entries(s.files).map(([key, url]) => [url, `${s.id}-${key}`])));
const fetcher = values.from
  ? async (url) => ({ text: await readFile(join(resolve(values.from), byUrl.get(url)), 'utf8') })
  : async (url) => {
      process.stdout.write(`  ${url}\n`);
      return httpFetcher(url);
    };

const started = Date.now();
const { manifest, outcomes } = await refreshLists(dir, {
  fetcher,
  only,
  onSource: (o) => console.log(`${o.ok ? '✓' : '✗'} ${o.source}${o.ok ? '' : `: ${o.error}`}`),
});
console.log(`\n${dir}`);
for (const l of manifest.lists) {
  console.log(`  ${l.id.padEnd(10)} ${String(l.entries).padStart(6)} entries  version ${l.versionDate || '—'}  sha256 ${l.sha256.slice(0, 12) || '—'}${l.lastError ? `  last refresh failed: ${l.lastError}` : ''}`);
}
console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s.`);
if (outcomes.some((o) => !o.ok)) process.exit(1);
