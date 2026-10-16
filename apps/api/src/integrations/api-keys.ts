import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { ApiPrincipal, ApiScope } from './account';

/** "dck_" + 8 characters shown in lists + "_" + 32 secret characters. */
const KEY = /^dck_([a-z0-9]{8})_([A-Za-z0-9]{32})$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LOWER = 'abcdefghijkmnpqrstuvwxyz23456789';
const pick = (alphabet: string, n: number) => [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join('');

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  rateLimit: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const toView = (r: Record<string, unknown>): ApiKeyView => ({
  id: r.id as string,
  name: r.name as string,
  prefix: r.prefix as string,
  scopes: r.scopes as ApiScope[],
  rateLimit: r.rate_limit as number,
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
  createdAt: new Date(r.created_at as string).toISOString(),
  revokedAt: r.revoked_at ? new Date(r.revoked_at as string).toISOString() : null,
});

/** API keys: made, listed and revoked from the Integrations page; checked on every /api/v1 request. */
@Injectable()
export class ApiKeysService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Makes a key. The key itself is in the answer only this once. */
  async create(accountId: string, userId: string, input: { name: string; scopes: ApiScope[]; rateLimit?: number }): Promise<ApiKeyView & { key: string }> {
    const prefix = `dck_${pick(LOWER, 8)}`;
    const key = `${prefix}_${pick(ALPHABET, 32)}`;
    const { rows } = await this.pool.query(
      `insert into api_keys (id, account_id, created_by, name, prefix, hash, scopes, rate_limit) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [randomUUID(), accountId, userId, input.name, prefix, hashKey(key), [...new Set(input.scopes)].sort(), input.rateLimit ?? 120],
    );
    return { ...toView(rows[0]), key };
  }

  async list(accountId: string): Promise<ApiKeyView[]> {
    const { rows } = await this.pool.query('select * from api_keys where account_id = $1 order by revoked_at is not null, created_at desc', [accountId]);
    return rows.map(toView);
  }

  /** Revoking is final: the key stops working at once and cannot be turned back on. */
  async revoke(accountId: string, id: string): Promise<ApiKeyView> {
    const { rows } = await this.pool.query('update api_keys set revoked_at = coalesce(revoked_at, now()) where id = $1 and account_id = $2 returning *', [id, accountId]);
    if (!rows[0]) throw new NotFoundException(`API key ${id} not found`);
    return toView(rows[0]);
  }

  /** The caller behind a key, or null for a malformed, unknown or revoked one. Notes when it was used (at most once a minute). */
  async authenticate(key: string): Promise<(ApiPrincipal & { rateLimit: number }) | null> {
    if (!KEY.test(key)) return null;
    const { rows } = await this.pool.query<{ id: string; account_id: string; scopes: ApiScope[]; rate_limit: number; last_used_at: Date | null }>(
      'select id, account_id, scopes, rate_limit, last_used_at from api_keys where hash = $1 and revoked_at is null',
      [hashKey(key)],
    );
    const r = rows[0];
    if (!r) return null;
    if (!r.last_used_at || Date.now() - r.last_used_at.getTime() > 60_000) {
      void this.pool.query('update api_keys set last_used_at = now() where id = $1', [r.id]).catch(() => undefined);
    }
    return { accountId: r.account_id, keyId: r.id, scopes: r.scopes, actingUserId: r.account_id, rateLimit: r.rate_limit };
  }
}
