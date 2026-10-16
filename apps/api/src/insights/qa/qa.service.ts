import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmClient } from '@doccheck/extraction';
import type { Pool } from 'pg';
import { PG_POOL } from '../../db/db.module';
import { InjectLlm } from '../../llm/llm.module';
import type { QaAnswer } from '../analytics.types';
import { answerQuestion } from './answer';
import { QaRunner } from './qa-runner';
import { SqlRejected } from './sql-guard';

/**
 * Questions about the account's data in plain language. The local model sees the question and the
 * description of the views, never a row of data; it writes SQL, which the guard checks, and
 * QaRunner runs it scoped to the asking account (answerQuestion).
 */
@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);
  readonly runner: QaRunner;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @InjectLlm() private readonly llm: LlmClient,
  ) {
    this.runner = new QaRunner(pool);
    void this.runner.hasRole().then((ok) => ok || this.logger.warn('Role doccheck_qa is missing: Data Q&A runs read-only behind the guard, without the role (see migration 019)'));
  }

  async ask(userId: string, question: string): Promise<QaAnswer> {
    try {
      const { output, result } = await answerQuestion(this.llm, this.runner, userId, question);
      return {
        question,
        sql: output.sql,
        ...(output.explanation ? { explanation: output.explanation } : {}),
        columns: result.columns,
        rows: result.rows,
        truncated: result.truncated,
        ms: result.ms,
        model: this.llm.provider.id,
        role: result.role,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const sql = (err as { sql?: string }).sql;
      if (err instanceof SqlRejected) throw new BadRequestException({ message: `The model wrote a query that is not allowed: ${message}`, code: 'sql_rejected', ...(sql ? { sql } : {}) });
      if (sql) throw new BadRequestException({ message: `The query did not run: ${message}`, code: 'sql_failed', sql });
      throw err;
    }
  }
}
