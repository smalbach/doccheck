import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { permissionsOfScopes, type ApiPrincipal, type ApiScope } from './account';

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
  /** The member who made it (null once they left). */
  createdBy: string | null;
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
  createdBy: (r.created_by_name as string) ?? null,
});

/** API keys: made, listed and revoked from the Integrations page; checked on every /api/v1 request. */
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  /** Makes a key. The key itself is in the answer only this once. */
  async create(orgId: string, userId: string, input: { name: string; scopes: ApiScope[]; rateLimit?: number }): Promise<ApiKeyView & { key: string }> {
    const prefix = `dck_${pick(LOWER, 8)}`;
    const key = `${prefix}_${pick(ALPHABET, 32)}`;
    const { rows } = await this.pool.query(
      `insert into api_keys (id, org_id, created_by, name, prefix, hash, scopes, rate_limit) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [randomUUID(), orgId, userId, input.name, prefix, hashKey(key), [...new Set(input.scopes)].sort(), input.rateLimit ?? 120],
    );
    const view = toView(rows[0]);
    // Never the key: its prefix identifies it.
    this.audit.note({ orgId, action: 'api_key.create', entity: 'api_key', entityId: view.id, after: { name: view.name, prefix: view.prefix, scopes: view.scopes, rateLimit: view.rateLimit } });
    return { ...(await this.list(orgId)).find((k) => k.id === view.id)!, key };
  }

  async list(orgId: string): Promise<ApiKeyView[]> {
    const { rows } = await this.pool.query(
      'select k.*, u.name as created_by_name from api_keys k left join users u on u.id = k.created_by where k.org_id = $1 order by k.revoked_at is not null, k.created_at desc',
      [orgId],
    );
    return rows.map(toView);
  }

  /** Revoking is final: the key stops working at once and cannot be turned back on. */
  async revoke(orgId: string, id: string): Promise<ApiKeyView> {
    const { rows } = await this.pool.query('update api_keys set revoked_at = coalesce(revoked_at, now()) where id = $1 and org_id = $2 returning *', [id, orgId]);
    if (!rows[0]) throw new NotFoundException(`API key ${id} not found`);
    const view = toView(rows[0]);
    this.audit.note({ orgId, action: 'api_key.revoke', entity: 'api_key', entityId: id, after: { name: view.name, prefix: view.prefix, revokedAt: view.revokedAt } });
    return (await this.list(orgId)).find((k) => k.id === id)!;
  }

  /** The caller behind a key, or null for a malformed, unknown or revoked one. Notes when it was used (at most once a minute). */
  async authenticate(key: string): Promise<(ApiPrincipal & { rateLimit: number }) | null> {
    if (!KEY.test(key)) return null;
    const { rows } = await this.pool.query<{ id: string; org_id: string; org_name: string; prefix: string; created_by: string | null; scopes: ApiScope[]; rate_limit: number; last_used_at: Date | null }>(
      `select k.id, k.org_id, o.name as org_name, k.prefix, k.created_by, k.scopes, k.rate_limit, k.last_used_at
       from api_keys k join organizations o on o.id = k.org_id where k.hash = $1 and k.revoked_at is null`,
      [hashKey(key)],
    );
    const r = rows[0];
    if (!r) return null;
    if (!r.last_used_at || Date.now() - r.last_used_at.getTime() > 60_000) {
      void this.pool.query('update api_keys set last_used_at = now() where id = $1', [r.id]).catch(() => undefined);
    }
    return { orgId: r.org_id, orgName: r.org_name, keyId: r.id, keyPrefix: r.prefix, scopes: r.scopes, permissions: permissionsOfScopes(r.scopes), actingUserId: r.created_by, rateLimit: r.rate_limit };
  }
}
