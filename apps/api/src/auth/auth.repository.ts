import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { PublicUser, UserRow } from './auth.types';

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: r.id as string,
  email: r.email as string,
  name: r.name as string,
  passwordHash: r.password_hash as string,
  createdAt: new Date(r.created_at as string).toISOString(),
});

@Injectable()
export class AuthRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** False when the email is taken. */
  async createUser(user: { id: string; email: string; name: string; passwordHash: string }): Promise<boolean> {
    const res = await this.pool.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4) on conflict (email) do nothing', [
      user.id,
      user.email,
      user.name,
      user.passwordHash,
    ]);
    return res.rowCount === 1;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query('select * from users where email = $1', [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query('select * from users where id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.pool.query('update users set name = $2, updated_at = now() where id = $1', [id, name]);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('update users set password_hash = $2, updated_at = now() where id = $1', [id, passwordHash]);
  }

  /**
   * Deletes the user and, by cascade, sessions, shipments, documents, extractions, ISF and findings,
   * unless a document is still extracting. Returns the storage keys of the user's PDFs.
   */
  async deleteUser(id: string): Promise<{ keys: string[] } | 'pending'> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select 1 from users where id = $1 for update', [id]);
      // Lock the user's shipments too, so an upload cannot slip a document in meanwhile.
      await client.query('select 1 from shipments where user_id = $1 for update', [id]);
      const docs = await client.query<{ storage_key: string; status: string }>(
        'select d.storage_key, d.status from documents d join shipments s on s.id = d.shipment_id where s.user_id = $1',
        [id],
      );
      if (docs.rows.some((r) => r.status === 'QUEUED' || r.status === 'EXTRACTING')) {
        await client.query('rollback');
        return 'pending';
      }
      await client.query('delete from users where id = $1', [id]);
      await client.query('commit');
      return { keys: docs.rows.map((r) => r.storage_key) };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);
  }

  /** The user of a live session; expired sessions are removed on the way. */
  async sessionUser(tokenHash: string): Promise<PublicUser | null> {
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.name, u.created_at, s.expires_at < now() as expired
       from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
      [tokenHash],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.expired) {
      await this.deleteSession(tokenHash);
      return null;
    }
    return { id: r.id, email: r.email, name: r.name, createdAt: new Date(r.created_at).toISOString() };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('delete from sessions where token_hash = $1', [tokenHash]);
  }

  /** Signs the user out everywhere except, optionally, the current session. */
  async deleteOtherSessions(userId: string, keepTokenHash?: string): Promise<void> {
    await this.pool.query('delete from sessions where user_id = $1 and token_hash is distinct from $2', [userId, keepTokenHash ?? null]);
  }
}
