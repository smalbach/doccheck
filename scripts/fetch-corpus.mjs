// Downloads the regulation corpus and converts it to Markdown with front matter:
//   data/corpus/<authority>/<id>.md
// Sources are public government pages. Run again to refresh; the eCFR date is the latest available.
// The source list and the converters live in packages/regulations/src/sources.ts, shared with the
// API's scheduled check for changed passages.
//
//   npm run corpus:fetch
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchCorpus } from '../packages/regulations/dist/sources.js';

const OUT = 'data/corpus';

for (const { source, file, effectiveDate } of await fetchCorpus()) {
  const dir = join(OUT, source.authority);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${source.id}.md`);
  await writeFile(path, file);
  console.log(`${path}: ${file.length} chars, effective ${effectiveDate}`);
}
