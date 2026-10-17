// Downloads the regulation corpus and converts it to Markdown with front matter:
//   data/corpus/<authority>/<id>.md
// Sources are public government pages. Run again to refresh; the eCFR date is the latest available.
// The CBSA and CBP sources and their converters live in packages/regulations/src/sources.ts, shared
// with the API's scheduled check for changed passages; Mexico, EU and UK sources and their converters
// are in scripts/corpus-intl.mjs (the scheduled check reads those too).
//
//   npm run corpus:fetch [-- --authority cbsa,cbp,anam,ucc,hmrc]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CORPUS_SOURCES, fetchCorpus, frontMatter } from '../packages/regulations/dist/sources.js';
import { convertIntl, INTL_SOURCES } from './corpus-intl.mjs';

const OUT = 'data/corpus';

const { values } = parseArgs({ options: { authority: { type: 'string' } } });
const only = values.authority?.split(',');
const pick = (s) => !only || only.includes(s.authority);
const retrievedAt = new Date().toISOString().slice(0, 10);

const write = async (s, markdown, url, effectiveDate) => {
  const dir = join(OUT, s.authority);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${s.id}.md`);
  await writeFile(file, frontMatter({ id: s.id, title: s.title, authority: s.authority.toUpperCase(), language: s.language, url, effectiveDate, retrievedAt }) + markdown + '\n');
  console.log(`${file}: ${markdown.length} chars, effective ${effectiveDate}`);
};

const cbsaCbp = CORPUS_SOURCES.filter(pick);
if (cbsaCbp.length) {
  for (const { source, file, effectiveDate } of await fetchCorpus(cbsaCbp)) {
    const dir = join(OUT, source.authority);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${source.id}.md`);
    await writeFile(path, file);
    console.log(`${path}: ${file.length} chars, effective ${effectiveDate}`);
  }
}

for (const s of INTL_SOURCES.filter(pick)) {
  try {
    const { markdown, url, effectiveDate } = await convertIntl(s);
    await write(s, markdown, url, effectiveDate);
  } catch (err) {
    if (!s.optional) throw err;
    console.warn(`Skipped ${s.id} (optional): ${err.message}`);
  }
}
