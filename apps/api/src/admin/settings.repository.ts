import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export interface StoredSetting {
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy?: string;
}

@Injectable()
export class SettingsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<StoredSetting[]> {
    const { rows } = await this.pool.query('select s.key, s.value, s.updated_at, u.email from settings s left join users u on u.id = s.updated_by');
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: new Date(r.updated_at).toISOString(), ...(r.email ? { updatedBy: r.email } : {}) }));
  }

  async save(entries: [string, unknown][], userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const [key, value] of entries) {
        await client.query(
          `insert into settings (key, value, updated_by) values ($1, $2, $3)
           on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), userId],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async remove(key: string): Promise<void> {
    await this.pool.query('delete from settings where key = $1', [key]);
  }
}
