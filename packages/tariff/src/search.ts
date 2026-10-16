import { tokenize, type Embedder } from '@doccheck/regulations';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Subheading, TariffSchedule } from './schedule';

/** Nearest subheadings (6-digit codes) to a text by embedding: in memory (index file) or in Postgres (pgvector). */
export interface VectorSource {
  readonly id: string;
  nearest(text: string, limit: number): Promise<{ code: string; score: number }[]>;
}

export interface Candidate extends Subheading {
  score: number;
  /** Rank in each retriever, for debugging the fusion. */
  ranks: { vector?: number; keyword?: number };
}

const K = 60;

/**
 * Words for keyword search: the regulation tokenizer plus a crude plural fold, because invoices say
 * "toy" and "shirt" where the schedule says "toys" and "shirts" ("glasses" -> "glass", "boxes" -> "box").
 */
export const terms = (text: string): string[] =>
  tokenize(text).map((t) => (t.length > 4 && /(ss|x|ch|sh)es$/.test(t) ? t.slice(0, -2) : t.length > 3 && /[^su]s$/.test(t) ? t.slice(0, -1) : t));

/**
 * Hybrid search of goods descriptions over the HS subheadings of a schedule: BM25 on the schedule
 * wording plus embeddings, merged by reciprocal rank fusion like the regulation search. Without
 * vectors (no index, embedding model down) it ranks by keywords alone.
 */
export class TariffSearch {
  private readonly subs: Subheading[];
  private readonly tf: Map<string, number>[];
  private readonly lengths: number[];
  private readonly docFreq = new Map<string, number>();
  private readonly avgLength: number;
  private readonly byCode: Map<string, Subheading>;

  constructor(
    readonly schedule: TariffSchedule,
    readonly vectors?: VectorSource,
  ) {
    this.subs = schedule.subheadings();
    this.byCode = new Map(this.subs.map((s) => [s.code, s]));
    this.tf = this.subs.map((s) => {
      const m = new Map<string, number>();
      for (const t of terms(s.text)) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
    this.lengths = this.tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
    for (const m of this.tf) for (const t of m.keys()) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  subheading(code6: string): Subheading | undefined {
    return this.byCode.get(code6);
  }

  keyword(text: string, limit: number): { code: string; score: number }[] {
    const query = [...new Set(terms(text))];
    const n = this.subs.length;
    const scored: { code: string; score: number }[] = [];
    this.tf.forEach((m, i) => {
      let score = 0;
      for (const term of query) {
        const tf = m.get(term);
        if (!tf) continue;
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * this.lengths[i]) / this.avgLength));
      }
      if (score > 0) scored.push({ code: this.subs[i].code, score });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async search(text: string, { limit = 5, pool = 50 }: { limit?: number; pool?: number } = {}): Promise<Candidate[]> {
    const byKeyword = this.keyword(text, pool);
    const byVector = this.vectors ? await this.vectors.nearest(text, pool).catch(() => []) : [];
    const fused = new Map<string, Candidate>();
    const hit = (code: string) => {
      const sub = this.byCode.get(code);
      if (!sub) return undefined;
      return fused.get(code) ?? fused.set(code, { ...sub, score: 0, ranks: {} }).get(code)!;
    };
    byVector.forEach(({ code }, rank) => {
      const c = hit(code);
      if (!c) return;
      c.score += 1 / (K + rank + 1);
      c.ranks.vector = rank + 1;
    });
    byKeyword.forEach(({ code }, rank) => {
      const c = hit(code);
      if (!c) return;
      c.score += 1 / (K + rank + 1);
      c.ranks.keyword = rank + 1;
    });
    return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** Index file metadata: <dir>/<schedule>-<model>.json next to the vectors in <schedule>-<model>.i8. */
interface VectorMeta {
  embedder: string;
  schedule: string;
  edition: string;
  dims: number;
  codes: string[];
}

/** The best score of each subheading among tariff-line scores, best first. */
export function bySubheading(scores: { code: string; score: number }[], limit: number): { code: string; score: number }[] {
  const best = new Map<string, number>();
  for (const { code, score } of scores) {
    const sub = code.slice(0, 6);
    if ((best.get(sub) ?? -Infinity) < score) best.set(sub, score);
  }
  return [...best].map(([code, score]) => ({ code, score })).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Tariff-line embeddings in memory (one vector per 8- or 10-digit line, ranked per subheading). On
 * disk each vector is a float32 scale plus int8 components: a quarter of float32, no visible change
 * in ranking.
 */
export class MemoryVectors implements VectorSource {
  readonly id: string;
  private readonly norms: Float32Array;

  constructor(
    readonly codes: string[],
    private readonly vectors: Float32Array,
    readonly dims: number,
    private readonly embedder: Embedder,
  ) {
    this.id = embedder.id;
    this.norms = new Float32Array(codes.length);
    for (let i = 0; i < codes.length; i++) {
      let s = 0;
      for (let d = 0; d < dims; d++) s += vectors[i * dims + d] ** 2;
      this.norms[i] = Math.sqrt(s) || 1;
    }
  }

  /** Vector of one code, for copying the index into Postgres. */
  vector(i: number): number[] {
    return Array.from(this.vectors.subarray(i * this.dims, (i + 1) * this.dims));
  }

  static async build(schedule: TariffSchedule, embedder: Embedder, { batch = 32, onProgress }: { batch?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<MemoryVectors> {
    const subs = schedule.lines();
    let dims = 0;
    let vectors = new Float32Array(0);
    for (let i = 0; i < subs.length; i += batch) {
      const slice = subs.slice(i, i + batch);
      const out = await embedder.embed(slice.map((s) => s.text));
      if (!dims) {
        dims = out[0].length;
        vectors = new Float32Array(subs.length * dims);
      }
      out.forEach((v, j) => vectors.set(v, (i + j) * dims));
      onProgress?.(Math.min(i + batch, subs.length), subs.length);
    }
    return new MemoryVectors(subs.map((s) => s.code), vectors, dims, embedder);
  }

  async save(file: string, schedule: TariffSchedule): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    const meta: VectorMeta = { embedder: this.id, schedule: schedule.id, edition: schedule.file.edition, dims: this.dims, codes: this.codes };
    const row = 4 + this.dims;
    const bytes = Buffer.alloc(this.codes.length * row);
    for (let i = 0; i < this.codes.length; i++) {
      const v = this.vectors.subarray(i * this.dims, (i + 1) * this.dims);
      const scale = v.reduce((m, x) => Math.max(m, Math.abs(x)), 0) / 127 || 1;
      bytes.writeFloatLE(scale, i * row);
      for (let d = 0; d < this.dims; d++) bytes.writeInt8(Math.round(v[d] / scale), i * row + 4 + d);
    }
    await writeFile(file.replace(/\.json$/, '.i8'), bytes);
    await writeFile(file, JSON.stringify(meta) + '\n');
  }

  static async load(file: string, embedder: Embedder): Promise<MemoryVectors> {
    const meta = JSON.parse(await readFile(file, 'utf8')) as VectorMeta;
    if (meta.embedder !== embedder.id) throw new Error(`Tariff index ${file} was built with ${meta.embedder}; rebuild it for ${embedder.id} (npm run tariff:index)`);
    const bytes = await readFile(file.replace(/\.json$/, '.i8'));
    const row = 4 + meta.dims;
    const vectors = new Float32Array(meta.codes.length * meta.dims);
    for (let i = 0; i < meta.codes.length; i++) {
      const scale = bytes.readFloatLE(i * row);
      for (let d = 0; d < meta.dims; d++) vectors[i * meta.dims + d] = bytes.readInt8(i * row + 4 + d) * scale;
    }
    return new MemoryVectors(meta.codes, vectors, meta.dims, embedder);
  }

  async nearest(text: string, limit: number): Promise<{ code: string; score: number }[]> {
    const [q] = await this.embedder.embed([text]);
    let qn = 0;
    for (const x of q) qn += x * x;
    qn = Math.sqrt(qn) || 1;
    const scores = this.codes.map((code, i) => {
      let dot = 0;
      const base = i * this.dims;
      for (let d = 0; d < this.dims; d++) dot += q[d] * this.vectors[base + d];
      return { code, score: dot / (qn * this.norms[i]) };
    });
    return bySubheading(scores, limit);
  }
}
