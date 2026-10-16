import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { AllowlistItem } from './screening.types';

/** Settings rows the thresholds are saved in (the settings table, beside the admin settings). */
export const THRESHOLD_KEYS = { match: 'screening.matchThreshold', review: 'screening.reviewThreshold' } as const;

const ITEM = `select a.id, a.user_id, owner.email as owner_email, a.party_name, a.party_key, a.list_id, a.entry_id, a.entry_name, a.reason,
    a.created_at, creator.email as created_by, a.removed_at, remover.email as removed_by, a.removed_reason
  from screening_allowlist a
  join users owner on owner.id = a.user_id
  left join users creator on creator.id = a.created_by
  left join users remover on remover.id = a.removed_by`;

const toItem = (r: Record<string, unknown>): AllowlistItem => ({
  id: r.id as string,
  userId: r.user_id as string,
  account: r.owner_email as string,
  partyName: r.party_name as string,
  partyKey: r.party_key as string,
  list: r.list_id as string,
  entryId: r.entry_id as string,
  entryName: r.entry_name as string,
  reason: r.reason as string,
  createdAt: new Date(r.created_at as string).toISOString(),
  ...(r.created_by ? { createdBy: r.created_by as string } : {}),
  ...(r.removed_at ? { removedAt: new Date(r.removed_at as string).toISOString() } : {}),
  ...(r.removed_by ? { removedBy: r.removed_by as string } : {}),
  ...(r.removed_reason ? { removedReason: r.removed_reason as string } : {}),
});

@Injectable()
export class ScreeningRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async shipmentOwner(shipmentId: string): Promise<string | undefined> {
    const { rows } = await this.pool.query<{ user_id: string | null }>('select user_id from shipments where id = $1', [shipmentId]);
    return rows[0]?.user_id ?? undefined;
  }

  /** The matches an account has set aside and not put back. */
  async activeAllowlist(userId: string): Promise<{ partyKey: string; list: string; entryId: string }[]> {
    const { rows } = await this.pool.query('select party_key, list_id, entry_id from screening_allowlist where user_id = $1 and removed_at is null', [userId]);
    return rows.map((r) => ({ partyKey: r.party_key, list: r.list_id, entryId: r.entry_id }));
  }

  /** An account's allowlist, or every account's (`userId` undefined), newest first; removed rows too when `history`. */
  async list(userId: string | undefined, history: boolean): Promise<AllowlistItem[]> {
    const where = [userId ? 'a.user_id = $1' : 'true', history ? 'true' : 'a.removed_at is null'].join(' and ');
    const { rows } = await this.pool.query(`${ITEM} where ${where} order by coalesce(a.removed_at, a.created_at) desc, a.id limit 500`, userId ? [userId] : []);
    return rows.map(toItem);
  }

  async find(id: string): Promise<AllowlistItem | undefined> {
    const { rows } = await this.pool.query(`${ITEM} where a.id = $1`, [id]);
    return rows[0] ? toItem(rows[0]) : undefined;
  }

  /** Adds an entry; `undefined` when the same match is already set aside for the account. */
  async add(e: { userId: string; partyName: string; partyKey: string; list: string; entryId: string; entryName: string; reason: string; createdBy: string }): Promise<AllowlistItem | undefined> {
    const id = randomUUID();
    const { rowCount } = await this.pool.query(
      `insert into screening_allowlist (id, user_id, party_name, party_key, list_id, entry_id, entry_name, reason, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing`,
      [id, e.userId, e.partyName, e.partyKey, e.list, e.entryId, e.entryName, e.reason, e.createdBy],
    );
    return rowCount ? this.find(id) : undefined;
  }

  async remove(id: string, removedBy: string, reason: string | undefined): Promise<boolean> {
    const { rowCount } = await this.pool.query('update screening_allowlist set removed_at = now(), removed_by = $2, removed_reason = $3 where id = $1 and removed_at is null', [id, removedBy, reason ?? null]);
    return (rowCount ?? 0) > 0;
  }

  async thresholds(): Promise<{ key: string; value: unknown; updatedAt: string; updatedBy?: string }[]> {
    const { rows } = await this.pool.query('select s.key, s.value, s.updated_at, u.email from settings s left join users u on u.id = s.updated_by where s.key = any($1)', [Object.values(THRESHOLD_KEYS)]);
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: new Date(r.updated_at).toISOString(), ...(r.email ? { updatedBy: r.email } : {}) }));
  }

  async saveThresholds(values: { match: number; review: number }, userId: string): Promise<void> {
    for (const [k, key] of Object.entries(THRESHOLD_KEYS) as ['match' | 'review', string][]) {
      await this.pool.query(
        `insert into settings (key, value, updated_by) values ($1, $2, $3)
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(values[k]), userId],
      );
    }
  }

  async resetThresholds(): Promise<void> {
    await this.pool.query('delete from settings where key = any($1)', [Object.values(THRESHOLD_KEYS)]);
  }
}
