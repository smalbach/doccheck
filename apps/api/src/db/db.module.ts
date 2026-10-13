import { Global, Inject, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { migrate } from './migrate';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
        return new Pool({ connectionString, max: 10 });
      },
    },
  ],
  exports: [PG_POOL],
})
export class DbModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    if (process.env.MIGRATE_ON_START === 'false') return;
    const applied = await migrate(this.pool);
    if (applied.length) Logger.log(`Applied migrations: ${applied.join(', ')}`, 'Db');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
