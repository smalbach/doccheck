import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClassificationResources } from '@doccheck/agent';
import { indexName } from '@doccheck/regulations';
import type { Destination } from '@doccheck/schemas';
import { findTariffDir, loadTariffData, MemoryVectors, TariffSearch, vectorIndexFile, type VectorSource } from '@doccheck/tariff';
import { existsSync } from 'node:fs';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';
import { embedderFromEnvOrNull } from '../llm/llm.module';
import { PgVectors } from './pg-vectors';

/**
 * The tariff schedule, notes and description search of each destination, loaded on first use from
 * data/tariff. Subheading vectors come from Postgres when pgvector is installed (copied there from
 * the index file the first time), otherwise from the index file in memory; without the file (or in
 * the read-only demo, which has no embedding model) the search ranks by keywords only. Without data/tariff the tariff checks that need it do not run.
 */
@Injectable()
export class TariffService {
  private readonly logger = new Logger(TariffService.name);
  private readonly loaded = new Map<Destination, Promise<ClassificationResources | null>>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The embedding model changed (or an index was rebuilt): load again on next use. */
  reset(): void {
    this.loaded.clear();
  }

  get(destination: Destination): Promise<ClassificationResources | null> {
    let res = this.loaded.get(destination);
    if (!res) {
      res = this.load(destination).catch((err: unknown) => {
        this.logger.warn(`Tariff data for ${destination} not loaded: ${err instanceof Error ? err.message : String(err)}`);
        this.loaded.delete(destination);
        return null;
      });
      this.loaded.set(destination, res);
    }
    return res;
  }

  private async load(destination: Destination): Promise<ClassificationResources | null> {
    // Schedules are bundled for Canada and the US; other destinations get the format checks only.
    if (destination !== 'US' && destination !== 'CA') return null;
    const dir = findTariffDir();
    if (!dir) {
      this.logger.warn('No tariff data (data/tariff); run npm run tariff:fetch. HS codes will only be checked for format.');
      return null;
    }
    const { schedule, notes } = await loadTariffData(dir, destination);
    const vectors = await this.vectors(dir, destination, schedule.file.edition);
    this.logger.log(`Loaded ${schedule.file.title} (${schedule.file.edition}): ${schedule.subheadings().length} subheadings, ${notes.notes.length} notes, ${vectors ? `vectors in ${vectors instanceof PgVectors ? 'Postgres' : 'memory'}` : 'keyword search only'}`);
    return { schedule, notes, search: new TariffSearch(schedule, vectors) };
  }

  private async vectors(dir: string, destination: Destination, edition: string): Promise<VectorSource | undefined> {
    // The read-only demo has no embedding model: it searches by keywords.
    if (isDemo()) return undefined;
    const embedder = embedderFromEnvOrNull(this.logger);
    if (!embedder) return undefined;
    const file = vectorIndexFile(dir, destination, indexName(embedder.id));
    if (!existsSync(file)) return undefined;
    const memory = await MemoryVectors.load(file, embedder);
    if (!(await PgVectors.available(this.pool).catch(() => false))) return memory;
    const pg = new PgVectors(this.pool, destination, embedder);
    if ((await pg.count(edition)) === 0) {
      await pg.load(memory, edition);
      this.logger.log(`Copied ${memory.codes.length} ${destination} tariff line vectors into Postgres (pgvector)`);
    }
    return pg;
  }
}
