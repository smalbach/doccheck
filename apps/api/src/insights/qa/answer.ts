import type { LlmClient } from '@doccheck/extraction';
import { QA_PROMPT_VERSION, QaOutput, qaSystemPrompt, qaUserPrompt } from './prompt';
import type { QaResult, QaRunner } from './qa-runner';
import { checkSql, SqlRejected } from './sql-guard';

/** Times the model may write the query again after the guard refused it or the database could not run it. */
export const QA_RETRIES = 1;

export interface Answered {
  output: QaOutput;
  result: QaResult;
  /** Queries tried before the one that ran. */
  attempts: number;
}

/**
 * Asks the model for a query, checks it and runs it scoped to `userId`. When the guard refuses it,
 * or the database cannot run it ("column ... does not exist"), the model gets one more try with that
 * reason. The reason is the guard's or the database's message about the query, never rows of data.
 * Used by the API and by the evaluation, so the measured accuracy is the app's.
 */
export async function answerQuestion(llm: LlmClient, runner: QaRunner, userId: string, question: string, opts: { maxRows?: number } = {}): Promise<Answered> {
  const system = qaSystemPrompt();
  let user = qaUserPrompt(question);
  for (let attempt = 0; ; attempt++) {
    const { output } = await llm.call(QA_PROMPT_VERSION, { system, user, schema: QaOutput });
    let reason: string;
    try {
      checkSql(output.sql);
    } catch (err) {
      if (!(err instanceof SqlRejected) || attempt >= QA_RETRIES) throw err;
      user = retryPrompt(question, output.sql, `it was refused: ${err.message}`);
      continue;
    }
    try {
      return { output, result: await runner.run(userId, output.sql, opts), attempts: attempt };
    } catch (err) {
      if (attempt >= QA_RETRIES || err instanceof SqlRejected) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { sql: output.sql });
      reason = `the database could not run it: ${err instanceof Error ? err.message : String(err)}`;
    }
    user = retryPrompt(question, output.sql, reason);
  }
}

const retryPrompt = (question: string, sql: string, reason: string) =>
  `${qaUserPrompt(question)}\n\nYour previous query did not work, ${reason}\nIt was:\n${sql}\nWrite it again, using only the views and columns listed.`;
