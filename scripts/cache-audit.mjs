// Lists the model responses cached in eval/cache by prompt version and model build, and removes stale
// ones so the next evaluation run asks the model again.
//
// Entries written before the cache recorded the model build have no `modelVersion`; for those the file's
// modification time is the only clue, so --before only makes sense on the machine that wrote them (a git
// checkout resets the times).
//
//   node scripts/cache-audit.mjs                                   # counts per directory
//   node scripts/cache-audit.mjs --prompt extract-v3 --before 2026-10-12T17:10 --unversioned   # list matches
//   node scripts/cache-audit.mjs ... --delete                      # and remove them
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'eval/cache' },
    prompt: { type: 'string' },
    before: { type: 'string' },
    build: { type: 'string' },
    unversioned: { type: 'boolean', default: false },
    delete: { type: 'boolean', default: false },
  },
});
const before = values.before ? new Date(values.before) : null;
if (before && Number.isNaN(before.getTime())) throw new Error(`--before is not a date: ${values.before}`);
const filtering = values.prompt || before || values.build || values.unversioned;
if (values.delete && !filtering) throw new Error('--delete needs at least one of --prompt, --before, --build, --unversioned');

const matches = [];
for (const sub of (await readdir(values.dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const counts = new Map();
  for (const name of (await readdir(join(values.dir, sub))).filter((f) => f.endsWith('.json'))) {
    const file = join(values.dir, sub, name);
    const entry = JSON.parse(await readFile(file, 'utf8'));
    const { mtime } = await stat(file);
    const key = `${entry.promptVersion} · ${entry.modelVersion ?? 'build not recorded'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (
      filtering &&
      (!values.prompt || entry.promptVersion === values.prompt) &&
      (!before || mtime < before) &&
      (!values.build || entry.modelVersion === values.build) &&
      (!values.unversioned || !entry.modelVersion)
    )
      matches.push({ file, promptVersion: entry.promptVersion, modelVersion: entry.modelVersion, mtime });
  }
  console.log(`${sub}`);
  for (const [key, n] of [...counts].sort()) console.log(`  ${String(n).padStart(4)}  ${key}`);
}

if (filtering) {
  matches.sort((a, b) => a.mtime - b.mtime);
  console.log(`\n${matches.length} matching entries${values.delete ? ' (deleted)' : ''}`);
  for (const m of matches) {
    console.log(`  ${m.mtime.toISOString()}  ${m.file}  ${m.promptVersion} · ${m.modelVersion ?? 'build not recorded'}`);
    if (values.delete) await unlink(m.file);
  }
}
