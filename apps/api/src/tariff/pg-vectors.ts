import type { Embedder } from '@doccheck/regulations';
import { bySubheading, type MemoryVectors, type VectorSource } from '@doccheck/tariff';
import type { Pool } from 'pg';

const literal = (v: number[]) => `[${v.join(',')}]`;

/** Nearest subheadings by cosine distance over tariff-line vectors in Postgres (pgvector), for one schedule and embedder. */
export class PgVectors implements VectorSource {
  readonly id: string;

  constructor(
    private readonly pool: Pool,
    private readonly schedule: string,
    private readonly embedder: Embedder,
  ) {
    this.id = embedder.id;
  }

  /** pgvector is installed and migration 045 created the table. */
  static async available(pool: Pool): Promise<boolean> {
    const { rows } = await pool.query<{ ok: boolean }>("select to_regclass('public.tariff_vectors') is not null as ok");
    return rows[0]?.ok ?? false;
  }

  /** Rows stored for this schedule, embedder and edition. */
  async count(edition: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('select count(*) as n from tariff_vectors where schedule = $1 and embedder = $2 and edition = $3', [this.schedule, this.embedder.id, edition]);
    return Number(rows[0].n);
  }

  /** Replaces the schedule's vectors with those of the index file, in one transaction. */
  async load(vectors: MemoryVectors, edition: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from tariff_vectors where schedule = $1 and embedder = $2', [this.schedule, this.embedder.id]);
      for (let i = 0; i < vectors.codes.length; i += 200) {
        const codes = vectors.codes.slice(i, i + 200);
        const values = codes.map((_, j) => `($1, $2, $3, $${4 + j * 2}, $${5 + j * 2}::vector)`).join(', ');
        await client.query(`insert into tariff_vectors (schedule, embedder, edition, code, embedding) values ${values}`, [
          this.schedule,
          this.embedder.id,
          edition,
          ...codes.flatMap((code, j) => [code, literal(vectors.vector(i + j))]),
        ]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async nearest(text: string, limit: number): Promise<{ code: string; score: number }[]> {
    const [q] = await this.embedder.embed([text]);
    // Rows are tariff lines; several lines of one subheading come back together, so fetch more and keep the best per subheading.
    const { rows } = await this.pool.query<{ code: string; score: number }>(
      'select code, 1 - (embedding <=> $3::vector) as score from tariff_vectors where schedule = $1 and embedder = $2 order by embedding <=> $3::vector limit $4',
      [this.schedule, this.embedder.id, literal(q), limit * 8],
    );
    return bySubheading(rows, limit);
  }
}
