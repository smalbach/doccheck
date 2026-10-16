import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, UnprocessableEntityException, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

const KEY = /^[\x21-\x7e]{1,255}$/;
const RETENTION = '24 hours';

export interface IdempotentResult<T> {
  status: number;
  body: T;
  /** The answer is the stored one of an earlier request with the same key. */
  replayed: boolean;
}

/** SHA-256 of what identifies a request: method, path and body (for uploads, each file's name and hash). */
export const requestHash = (...parts: (string | Buffer)[]) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : p).update('\u0000');
  return h.digest('hex');
};

/**
 * Idempotency-Key on the public API's creates and uploads. The first request with a key reserves it
 * and runs; when it succeeds its status and body are stored for 24 hours, and a retry with the same
 * key and the same request gets that answer again (Idempotent-Replayed: true) without doing the work
 * twice. The same key with another request is a 422; while the first is still running, a 409.
 * A request that fails releases the key, so it can be retried.
 */
@Injectable()
export class IdempotencyStore implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IdempotencyStore.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.prune(), 60 * 60 * 1000);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async run<T>(keyId: string, idempotencyKey: string | undefined, hash: string, status: number, work: () => Promise<T>): Promise<IdempotentResult<T>> {
    if (idempotencyKey === undefined) return { status, body: await work(), replayed: false };
    if (!KEY.test(idempotencyKey)) throw new BadRequestException('Idempotency-Key must be 1 to 255 visible ASCII characters');
    await this.pool.query(`delete from api_idempotency where key_id = $1 and idempotency_key = $2 and created_at < now() - interval '${RETENTION}'`, [keyId, idempotencyKey]);
    const reserved = await this.pool.query('insert into api_idempotency (key_id, idempotency_key, request_hash) values ($1, $2, $3) on conflict do nothing', [keyId, idempotencyKey, hash]);
    if (reserved.rowCount === 0) {
      const { rows } = await this.pool.query<{ request_hash: string; status: number | null; response: T }>('select request_hash, status, response from api_idempotency where key_id = $1 and idempotency_key = $2', [keyId, idempotencyKey]);
      const prior = rows[0];
      if (!prior) return this.run(keyId, idempotencyKey, hash, status, work);
      if (prior.request_hash !== hash) throw new UnprocessableEntityException('This Idempotency-Key was used for a different request');
      if (prior.status === null) throw new ConflictException('A request with this Idempotency-Key is still being processed; retry shortly');
      return { status: prior.status, body: prior.response, replayed: true };
    }
    try {
      const body = await work();
      await this.pool.query('update api_idempotency set status = $3, response = $4 where key_id = $1 and idempotency_key = $2', [keyId, idempotencyKey, status, JSON.stringify(body)]);
      return { status, body, replayed: false };
    } catch (err) {
      await this.pool.query('delete from api_idempotency where key_id = $1 and idempotency_key = $2', [keyId, idempotencyKey]).catch(() => undefined);
      if (!(err instanceof HttpException)) this.logger.warn(`Idempotent request failed: ${(err as Error).message}`);
      throw err;
    }
  }

  private async prune() {
    await this.pool.query(`delete from api_idempotency where created_at < now() - interval '${RETENTION}'`).catch(() => undefined);
  }
}
