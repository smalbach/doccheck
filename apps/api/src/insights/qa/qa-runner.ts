import type { Pool } from 'pg';
import { checkSql, wrapWithLimit } from './sql-guard';

/** Rows a question returns at most. */
export const QA_MAX_ROWS = 200;
/** How long a checked query may run. */
export const QA_TIMEOUT_MS = 3000;
export const QA_ROLE = 'doccheck_qa';

export interface QaResult {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
  role: boolean;
}

/**
 * Runs a query the guard accepted, for organization `orgId`: in a read-only transaction that is always rolled
 * back, with a statement timeout, the qa views alone on the search path, the organization in the
 * transaction setting the views filter on, and (when the database has it) the role that can read
 * only those views. Throws SqlRejected for a query the guard refuses, or the database error.
 */
export class QaRunner {
  private role?: Promise<boolean>;

  constructor(private readonly pool: Pool) {}

  /** Whether the read-only role exists and this connection may switch to it (migration 049). */
  hasRole(): Promise<boolean> {
    this.role ??= this.pool
      .query<{ ok: boolean }>(`select exists (select 1 from pg_roles where rolname = $1) and pg_has_role(current_user, (select oid from pg_roles where rolname = $1), 'member') as ok`, [QA_ROLE])
      .then((r) => r.rows[0]?.ok === true, () => false);
    return this.role;
  }

  async run(orgId: string, sql: string, opts: { maxRows?: number; timeoutMs?: number } = {}): Promise<QaResult> {
    const checked = checkSql(sql);
    const maxRows = opts.maxRows ?? QA_MAX_ROWS;
    const role = await this.hasRole();
    const client = await this.pool.connect();
    const started = Date.now();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      await client.query(`set local statement_timeout = ${Math.max(100, Math.floor(opts.timeoutMs ?? QA_TIMEOUT_MS))}`);
      await client.query(`set local idle_in_transaction_session_timeout = 10000`);
      await client.query(`select set_config('doccheck.qa_org', $1, true), set_config('search_path', 'qa', true)`, [orgId]);
      if (role) await client.query(`set local role ${QA_ROLE}`);
      const res = await client.query({ text: wrapWithLimit(checked.sql, maxRows + 1), rowMode: 'array' });
      const rows = res.rows as unknown[][];
      return { columns: res.fields.map((f) => f.name), rows: rows.slice(0, maxRows), truncated: rows.length > maxRows, ms: Date.now() - started, role };
    } finally {
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  }
}
