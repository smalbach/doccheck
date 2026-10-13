import { Pool } from 'pg';
import { loadEnv } from '../env';
import { migrate } from './migrate';

/** npm run db:migrate -w @doccheck/api */
async function main() {
  loadEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
