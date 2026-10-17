import { OllamaEmbedder } from '@doccheck/regulations';
import type { Destination } from '@doccheck/schemas';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { findTariffDir, loadTariffData, vectorIndexFile } from './data';
import { formatHs, hsDigits } from './hs-code';
import { codeStatus, agencyFlags } from './lines';
import { MemoryVectors, TariffSearch } from './search';

/**
 *   node dist/cli.js index [--schedule us|ca]       embed every tariff line (8 and 10 digits) into data/tariff/index/<schedule>-<model>.json
 *   node dist/cli.js search "plush teddy bears" --schedule us
 *   node dist/cli.js check 9503.00.00.90 --schedule ca
 * EMBED_MODEL (default bge-m3), OLLAMA_BASE_URL, TARIFF_DIR.
 */
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { schedule: { type: 'string' }, limit: { type: 'string', default: '5' } } });
  const dir = findTariffDir();
  if (!dir) throw new Error('No tariff data: run npm run tariff:fetch');
  const model = process.env.EMBED_MODEL || 'bge-m3';
  const embedder = new OllamaEmbedder(model, process.env.OLLAMA_BASE_URL || undefined);
  const schedules = (values.schedule ? [values.schedule.toUpperCase()] : ['US', 'CA']) as Destination[];
  const [command, ...rest] = positionals;

  if (command === 'index') {
    for (const id of schedules) {
      const { schedule } = await loadTariffData(dir, id);
      const started = Date.now();
      const vectors = await MemoryVectors.build(schedule, embedder, { onProgress: (done, total) => process.stdout.write(`\r${id}: ${done}/${total}`) });
      const file = vectorIndexFile(dir, id, model);
      await vectors.save(file, schedule);
      console.log(`\n${id}: ${vectors.codes.length} tariff lines embedded with ${embedder.id} in ${Math.round((Date.now() - started) / 1000)} s -> ${file}`);
    }
    return;
  }
  if (command === 'search') {
    for (const id of schedules) {
      const { schedule } = await loadTariffData(dir, id);
      const file = vectorIndexFile(dir, id, model);
      const search = new TariffSearch(schedule, existsSync(file) ? await MemoryVectors.load(file, embedder) : undefined);
      console.log(`\n${id}${search.vectors ? '' : ' (keywords only: no index)'}`);
      for (const c of await search.search(rest.join(' '), { limit: Number(values.limit) })) {
        console.log(`  ${formatHs(c.code)}  [${c.score.toFixed(4)} v${c.ranks.vector ?? '-'} k${c.ranks.keyword ?? '-'}]  ${c.title.slice(0, 140)}`);
      }
    }
    return;
  }
  if (command === 'check') {
    for (const id of schedules) {
      const { schedule } = await loadTariffData(dir, id);
      const digits = hsDigits(rest[0] ?? '');
      console.log(`${id}: ${codeStatus(rest[0], schedule)} — ${schedule.describe(digits) ?? 'not found'}`);
      for (const a of agencyFlags(digits, id)) console.log(`  ${a.agency}: ${a.program}`);
    }
    return;
  }
  console.error('Usage: cli.js index | search <description> | check <code>  [--schedule us|ca]');
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
