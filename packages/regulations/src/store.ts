import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chunkDocument, loadCorpus } from './corpus';
import { RegulationIndex, type Embedder, type IndexedChunk } from './search';

/** Embeds the corpus and saves the index, so the API only embeds queries at run time. */
export async function buildIndexFile(corpusDir: string, file: string, embedder: Embedder): Promise<RegulationIndex> {
  const docs = await loadCorpus(corpusDir);
  const index = await RegulationIndex.build(docs.flatMap((d) => chunkDocument(d)), embedder);
  await mkdir(dirname(file), { recursive: true });
  // Round vectors to 5 decimals: a third of the size, no measurable effect on ranking.
  const json = JSON.stringify(index.toJSON(), (k, v) => (k === 'embedding' ? (v as number[]).map((x) => Math.round(x * 1e5) / 1e5) : v));
  await writeFile(file, json + '\n');
  return index;
}

export async function loadIndexFile(file: string, embedder: Embedder): Promise<RegulationIndex> {
  const data = JSON.parse(await readFile(file, 'utf8')) as { embedder: string; chunks: IndexedChunk[] };
  if (data.embedder !== embedder.id) {
    throw new Error(`Index ${file} was built with ${data.embedder}; rebuild it for ${embedder.id} (npm run corpus:index)`);
  }
  return new RegulationIndex(data.chunks, embedder);
}
