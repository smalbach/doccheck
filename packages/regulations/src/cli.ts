import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { excerpt, OllamaEmbedder } from './search';
import { buildIndexFile, loadIndexFile } from './store';

/**
 *   node dist/cli.js index                        embed data/corpus into data/corpus/index/<model>.json
 *   node dist/cli.js search "country of origin" --authority CBSA
 * EMBED_MODEL (default bge-m3), OLLAMA_BASE_URL.
 */
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { corpus: { type: 'string', default: 'data/corpus' }, authority: { type: 'string' }, limit: { type: 'string', default: '3' } },
  });
  const model = process.env.EMBED_MODEL || 'bge-m3';
  const embedder = new OllamaEmbedder(model, process.env.OLLAMA_BASE_URL || undefined);
  const file = resolve(values.corpus!, 'index', `${model}.json`);
  const [command, ...rest] = positionals;

  if (command === 'index') {
    const started = Date.now();
    const index = await buildIndexFile(resolve(values.corpus!), file, embedder);
    console.log(`Indexed ${index.chunks.length} chunks with ${embedder.id} in ${Date.now() - started} ms -> ${file}`);
    return;
  }
  if (command === 'search') {
    const query = rest.join(' ');
    const index = await loadIndexFile(file, embedder);
    for (const hit of await index.search(query, { authority: values.authority as 'CBSA' | 'CBP' | undefined, limit: Number(values.limit) })) {
      console.log(`\n[${hit.score.toFixed(4)} v${hit.ranks.vector ?? '-'} k${hit.ranks.keyword ?? '-'}] ${hit.chunk.title} — ${hit.chunk.section}`);
      console.log(`  ${excerpt(hit.chunk.text, query, 300)}`);
    }
    return;
  }
  console.error('Usage: cli.js index | search <query> [--authority CBSA|CBP]');
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
