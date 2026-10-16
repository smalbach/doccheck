/**
 * Data Q&A evaluation: questions with a known answer (eval/qa/questions.json, each with the SQL that
 * answers it) over a fixed account history built from the synthetic set. Each question goes to the
 * local model as in the app (answerQuestion, with its one retry); its query passes the guard and runs scoped to the account like any
 * other, and its result must contain the expected one: the same number of rows, each with the
 * expected values (column names and order, and extra columns, do not matter; numbers compared to
 * 2 decimals). A second account with its own shipments checks that no answer shows its rows.
 *
 *   npm run eval:qa [-- --limit 5] [--replay]
 *
 * Needs Postgres: DATABASE_URL_QA_EVAL, or DATABASE_URL with the database renamed to doccheck_qa_eval
 * (dropped and recreated, so the name must end in _eval). Model answers are cached in
 * eval/cache/qa_<model>/, so a rerun needs no model (--replay fails on a cache miss).
 * Writes eval/reports/qa-<model>.json.
 */
import { LlmClient, OllamaProvider } from '@doccheck/extraction';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client, Pool } from 'pg';
import { migrate } from '../../db/migrate';
import { buildFixture } from './fixture';
import { answerQuestion } from './answer';
import { QA_PROMPT_VERSION } from './prompt';
import { QaRunner } from './qa-runner';
import { SqlRejected } from './sql-guard';

const root = [process.cwd(), resolve(__dirname, '../../../../..')].find((d) => existsSync(join(d, 'eval/qa/questions.json'))) ?? process.cwd();
try {
  process.loadEnvFile(join(root, '.env'));
} catch {}

const { values } = parseArgs({ options: { limit: { type: 'string' }, replay: { type: 'boolean', default: false } } });

interface Question {
  id: string;
  question: string;
  sql: string;
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? (Math.round(Number(s) * 100) / 100).toFixed(2) : s.toLowerCase();
};

/** Same row count, and each expected row's values found in a distinct row of the answer. */
export function contains(expected: unknown[][], actual: unknown[][]): boolean {
  if (expected.length !== actual.length) return false;
  const left = actual.map((r) => r.map(cell));
  for (const row of expected.map((r) => r.map(cell))) {
    const k = left.findIndex((a) => {
      const pool = [...a];
      return row.every((c) => {
        const i = pool.indexOf(c);
        if (i < 0) return false;
        pool.splice(i, 1);
        return true;
      });
    });
    if (k < 0) return false;
    left.splice(k, 1);
  }
  return true;
}

async function main() {
  const url = (() => {
    if (process.env.DATABASE_URL_QA_EVAL) return process.env.DATABASE_URL_QA_EVAL;
    const u = new URL(process.env.DATABASE_URL ?? 'postgres://doccheck:doccheck@localhost:5432/doccheck');
    u.pathname = '/doccheck_qa_eval';
    return u.toString();
  })();
  const db = new URL(url).pathname.slice(1);
  if (!db.endsWith('_eval')) throw new Error(`Refusing to reset "${db}": the database name must end in _eval`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`drop database if exists ${db}`);
  await c.query(`create database ${db}`);
  await c.end();

  const pool = new Pool({ connectionString: url, max: 4 });
  await migrate(pool);
  const users = { a: randomUUID(), b: randomUUID() };
  for (const [k, id] of Object.entries(users)) {
    await pool.query(`insert into users (id, email, name, password_hash) values ($1, $2, $3, 'x')`, [id, `qa-eval-${k}@doccheck.invalid`, `QA eval ${k}`]);
  }
  const evalDir = join(root, 'data/eval/v1');
  const ref = (p: string, n: number) => `${p}-${String(n).padStart(3, '0')}`;
  const mine = [...Array.from({ length: 20 }, (_, i) => ref('CA', i + 1)), ...Array.from({ length: 20 }, (_, i) => ref('US', i + 1))];
  const theirs = [ref('CA', 50), ref('US', 50), ref('US', 51)];
  // Interleave the destinations so both appear in every month.
  const order = mine.map((_, i) => mine[(i % 2) * 20 + Math.floor(i / 2)]);
  await buildFixture(pool, users.a, evalDir, order);
  await buildFixture(pool, users.b, evalDir, theirs);

  const model = process.env.LLM_MODEL || 'qwen3.8';
  const provider = new OllamaProvider(model, process.env.OLLAMA_BASE_URL || undefined);
  const llm = new LlmClient(provider, join(root, 'eval/cache', `qa_${provider.id.replace(/[^a-z0-9.-]/gi, '_')}`), values.replay ? 'replay' : 'readwrite');
  const runner = new QaRunner(pool);
  const questions = (JSON.parse(await readFile(join(root, 'eval/qa/questions.json'), 'utf8')) as Question[]).slice(0, values.limit ? Number(values.limit) : undefined);
  const theirRefs = new Set(theirs);

  const results = [];
  for (const q of questions) {
    const expected = await runner.run(users.a, q.sql, { maxRows: 1000 });
    let sql = '';
    let status: 'correct' | 'wrong' | 'rejected' | 'error' = 'error';
    let detail: string | undefined;
    let leaked = false;
    let attempts = 0;
    try {
      const answered = await answerQuestion(llm, runner, users.a, q.question, { maxRows: 1000 });
      sql = answered.output.sql;
      attempts = answered.attempts;
      const actual = answered.result;
      leaked = actual.rows.some((r) => r.some((v) => typeof v === 'string' && theirRefs.has(v)));
      status = contains(expected.rows, actual.rows) && !leaked ? 'correct' : 'wrong';
      if (status === 'wrong') detail = `expected ${JSON.stringify(expected.rows.slice(0, 5))}, got ${JSON.stringify(actual.rows.slice(0, 5))}`;
    } catch (err) {
      sql = (err as { sql?: string }).sql ?? sql;
      status = err instanceof SqlRejected ? 'rejected' : 'error';
      detail = err instanceof Error ? err.message : String(err);
    }
    console.log(`${status === 'correct' ? '✓' : '✗'} ${q.id} ${q.question}${status === 'correct' ? '' : ` (${status})`}`);
    results.push({ id: q.id, question: q.question, status, sql, attempts, expectedSql: q.sql, expectedRows: expected.rows.length, leaked, ...(detail ? { detail: detail.slice(0, 600) } : {}) });
  }
  const correct = results.filter((r) => r.status === 'correct').length;
  const report = {
    provider: provider.id,
    promptVersion: QA_PROMPT_VERSION,
    role: await runner.hasRole(),
    total: results.length,
    correct,
    accuracy: results.length ? correct / results.length : 0,
    retried: results.filter((r) => r.attempts > 0).length,
    rejected: results.filter((r) => r.status === 'rejected').length,
    errors: results.filter((r) => r.status === 'error').length,
    leaked: results.filter((r) => r.leaked).length,
    results,
  };
  await mkdir(join(root, 'eval/reports'), { recursive: true });
  const file = join(root, 'eval/reports', `qa-${provider.id.replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${correct}/${results.length} correct (${(report.accuracy * 100).toFixed(1)}%), ${report.rejected} refused by the guard, ${report.errors} failed, ${report.leaked} showing another account's rows. ${file}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
