import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { isDemo } from '../demo/demo-mode';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check() {
    // Later: Redis and queue status.
    const database = await this.pool.query('select 1').then(() => 'ok', (err: Error) => `error: ${err.message}`);
    return { status: database === 'ok' ? 'ok' : 'degraded', service: 'doccheck-api', database, demo: isDemo(), time: new Date().toISOString() };
  }
}
