import type { Chunk } from './corpus';

/** Text -> vector. The default implementation calls a local Ollama embedding model. */
export interface Embedder {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class OllamaEmbedder implements Embedder {
  readonly id: string;
  constructor(
    private readonly model = 'bge-m3',
    private readonly baseUrl = 'http://localhost:11434',
  ) {
    this.id = `ollama:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
    } catch (err) {
      throw new Error(`Ollama is not reachable at ${this.baseUrl} (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { embeddings: number[][] };
    return body.embeddings;
  }
}

export interface IndexedChunk extends Chunk {
  embedding: number[];
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
  /** Rank in each retriever, for debugging the fusion. */
  ranks: { vector?: number; keyword?: number };
}

export interface SearchOptions {
  authority?: 'CBSA' | 'CBP';
  /** Preferred language; other languages are still returned when they rank higher. */
  language?: string;
  limit?: number;
}

const STOP = new Set('a an and are as at be by for from has in is it its of on or that the this to was were will with must shall each any all not if'.split(' '));

export function tokenize(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

/**
 * Hybrid search over the regulation corpus: cosine similarity on embeddings plus BM25 on words,
 * merged with reciprocal rank fusion. Exact search in memory: the corpus is a few hundred chunks,
 * so an approximate index (pgvector HNSW) only pays off once it grows by orders of magnitude.
 */
export class RegulationIndex {
  private readonly docFreq = new Map<string, number>();
  private readonly tokens: string[][];
  private readonly avgLength: number;

  constructor(
    readonly chunks: IndexedChunk[],
    private readonly embedder: Embedder,
  ) {
    this.tokens = chunks.map((c) => tokenize(`${c.section} ${c.text}`));
    for (const t of this.tokens) for (const term of new Set(t)) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    this.avgLength = this.tokens.reduce((a, t) => a + t.length, 0) / Math.max(1, this.tokens.length);
  }

  static async build(chunks: Chunk[], embedder: Embedder, batch = 16): Promise<RegulationIndex> {
    const indexed: IndexedChunk[] = [];
    for (let i = 0; i < chunks.length; i += batch) {
      const slice = chunks.slice(i, i + batch);
      const vectors = await embedder.embed(slice.map((c) => `${c.title}\n${c.section}\n\n${c.text}`));
      slice.forEach((c, j) => indexed.push({ ...c, embedding: vectors[j] }));
    }
    return new RegulationIndex(indexed, embedder);
  }

  private bm25(query: string[], i: number, k1 = 1.2, b = 0.75): number {
    const doc = this.tokens[i];
    let score = 0;
    for (const term of new Set(query)) {
      const tf = doc.filter((t) => t === term).length;
      if (tf === 0) continue;
      const df = this.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (this.chunks.length - df + 0.5) / (df + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / this.avgLength));
    }
    return score;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const candidates = this.chunks.map((c, i) => ({ c, i })).filter(({ c }) => !opts.authority || c.authority === opts.authority);
    if (candidates.length === 0) return [];
    const [qv] = await this.embedder.embed([query]);
    const qt = tokenize(query);

    const byVector = candidates.map(({ c, i }) => ({ i, s: cosine(qv, c.embedding) })).sort((a, b) => b.s - a.s);
    const byKeyword = candidates.map(({ i }) => ({ i, s: this.bm25(qt, i) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const fused = new Map<number, SearchHit>();
    const K = 60;
    byVector.forEach(({ i }, rank) => fused.set(i, { chunk: this.chunks[i], score: 1 / (K + rank + 1), ranks: { vector: rank + 1 } }));
    byKeyword.forEach(({ i }, rank) => {
      const hit = fused.get(i)!;
      hit.score += 1 / (K + rank + 1);
      hit.ranks.keyword = rank + 1;
    });
    // Same passage in two languages: keep the preferred language unless the other ranks clearly higher.
    const hits = [...fused.values()].map((h) => ({ ...h, score: h.score * (opts.language && h.chunk.language !== opts.language ? 0.9 : 1) }));
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.limit ?? 5).map((h) => ({ ...h, chunk: stripEmbedding(h.chunk) }));
  }

  toJSON() {
    return { embedder: this.embedder.id, chunks: this.chunks };
  }
}

const stripEmbedding = (c: Chunk | IndexedChunk): Chunk => {
  const { embedding: _e, ...chunk } = c as IndexedChunk;
  void _e;
  return chunk;
};

/** Sentence-aligned excerpt of at most `max` characters around the query terms. */
export function excerpt(text: string, query: string, max = 500): string {
  // Sentences, and a hard break before each "Field N:" so one form field is never quoted with the next.
  const sentences = text.split(/(?<=[.;])\s+(?=[A-Z(0-9])|\s+(?=Field \d+:)/);
  const terms = new Set(tokenize(query));
  const scored = sentences.map((s, i) => ({ i, score: tokenize(s).filter((t) => terms.has(t)).length }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), scored[0]);
  // Keep a short paragraph label in front of the sentence: "(7) Country of origin." + its definition.
  const label = best.i > 0 && /^\(\w+\)[^.]{0,60}\.$/.test(sentences[best.i - 1]) ? `${sentences[best.i - 1]} ` : '';
  let out = label + sentences[best.i];
  for (let j = best.i + 1; j < sentences.length && !/^Field \d+:/.test(sentences[j]) && out.length + sentences[j].length + 1 <= max; j++) out += ` ${sentences[j]}`;
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}
