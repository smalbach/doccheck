import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { PublicUser, Role, SessionInfo, SessionOrigin, UserRow } from './auth.types';

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: r.id as string,
  email: r.email as string,
  name: r.name as string,
  role: r.role as Role,
  passwordHash: r.password_hash as string,
  createdAt: new Date(r.created_at as string).toISOString(),
});

@Injectable()
export class AuthRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** False when the email is taken. */
  async createUser(user: { id: string; email: string; name: string; passwordHash: string; role: Role }): Promise<boolean> {
    const res = await this.pool.query('insert into users (id, email, name, password_hash, role) values ($1, $2, $3, $4, $5) on conflict (email) do nothing', [
      user.id,
      user.email,
      user.name,
      user.passwordHash,
      user.role,
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

  /** Makes these accounts admins (never demotes anyone). Returns how many changed. */
  async promoteAdmins(emails: readonly string[]): Promise<number> {
    if (!emails.length) return 0;
    const res = await this.pool.query("update users set role = 'admin', updated_at = now() where email = any($1) and role <> 'admin'", [emails]);
    return res.rowCount ?? 0;
  }

  async updateName(id: string, name: string): Promise<void> {
    await this.pool.query('update users set name = $2, updated_at = now() where id = $1', [id, name]);
  }

  async updateLanguage(id: string, language: string): Promise<void> {
    await this.pool.query('update users set language = $2 where id = $1 and language is distinct from $2', [id, language]);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('update users set password_hash = $2, updated_at = now() where id = $1', [id, passwordHash]);
  }

  /**
   * Deletes the user with the organizations only they belong to (by cascade their shipments, documents,
   * extractions, ISF and findings), unless a document there is still extracting, or the user is the
   * last owner of an organization others still use. Returns the storage keys of the deleted PDFs.
   */
  async deleteUser(id: string): Promise<{ keys: string[] } | 'pending' | { lastOwnerOf: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select 1 from users where id = $1 for update', [id]);
      const { rows: orgs } = await client.query<{ org_id: string; name: string; role: string; members: number; owners: number }>(
        `select m.org_id, o.name, m.role,
           (select count(*)::int from org_members x where x.org_id = m.org_id) as members,
           (select count(*)::int from org_members x where x.org_id = m.org_id and x.role = 'owner') as owners
         from org_members m join organizations o on o.id = m.org_id where m.user_id = $1 for update of m`,
        [id],
      );
      const lastOwnerOf = orgs.filter((o) => o.members > 1 && o.role === 'owner' && o.owners === 1).map((o) => o.name);
      if (lastOwnerOf.length) {
        await client.query('rollback');
        return { lastOwnerOf };
      }
      const alone = orgs.filter((o) => o.members === 1).map((o) => o.org_id);
      // Lock their shipments too, so an upload cannot slip a document in meanwhile.
      await client.query('select 1 from shipments where org_id = any($1) for update', [alone]);
      const docs = await client.query<{ storage_key: string; status: string }>(
        'select d.storage_key, d.status from documents d join shipments s on s.id = d.shipment_id where s.org_id = any($1)',
        [alone],
      );
      if (docs.rows.some((r) => r.status === 'QUEUED' || r.status === 'EXTRACTING')) {
        await client.query('rollback');
        return 'pending';
      }
      await client.query('delete from organizations where id = any($1)', [alone]);
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

  async createSession(tokenHash: string, userId: string, expiresAt: Date, origin: SessionOrigin = {}): Promise<void> {
    await this.pool.query(
      `insert into sessions (token_hash, user_id, expires_at, ip, user_agent, method, org_id)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, (select last_org_id from users where id = $2)))`,
      [tokenHash, userId, expiresAt, origin.ip ?? null, origin.userAgent?.slice(0, 300) ?? null, origin.method ?? 'password', origin.orgId ?? null],
    );
  }

  /**
   * The user of a live session, with the session's id and organization; expired sessions are removed on
   * the way. last_seen_at is written at most every five minutes.
   */
  async sessionUser(tokenHash: string): Promise<{ user: PublicUser; sessionId: string; orgId: string | null } | null> {
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.name, u.role, u.created_at, s.id as session_id, s.org_id, s.expires_at < now() as expired,
         s.last_seen_at < now() - interval '5 minutes' as stale
       from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
      [tokenHash],
    );
    const r = rows[0];
    if (!r) return null;
    if (r.expired) {
      await this.deleteSession(tokenHash);
      return null;
    }
    if (r.stale) await this.pool.query('update sessions set last_seen_at = now() where token_hash = $1', [tokenHash]);
    return { user: { id: r.id, email: r.email, name: r.name, role: r.role, createdAt: new Date(r.created_at).toISOString() }, sessionId: r.session_id, orgId: r.org_id };
  }

  async listSessions(userId: string, currentTokenHash?: string): Promise<SessionInfo[]> {
    const { rows } = await this.pool.query(
      `select id, method, ip, user_agent, created_at, last_seen_at, expires_at, token_hash = $2 as current
       from sessions where user_id = $1 and expires_at > now() order by last_seen_at desc`,
      [userId, currentTokenHash ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      current: r.current === true,
      method: r.method,
      ...(r.ip ? { ip: r.ip } : {}),
      ...(r.user_agent ? { userAgent: r.user_agent } : {}),
      createdAt: new Date(r.created_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
  }

  /** Signs out one of the user's sessions by its id. */
  async deleteSessionById(userId: string, id: string): Promise<boolean> {
    const res = await this.pool.query('delete from sessions where user_id = $1 and id = $2', [userId, id]);
    return res.rowCount === 1;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('delete from sessions where token_hash = $1', [tokenHash]);
  }

  /** Signs the user out everywhere except, optionally, the current session. */
  async deleteOtherSessions(userId: string, keepTokenHash?: string): Promise<void> {
    await this.pool.query('delete from sessions where user_id = $1 and token_hash is distinct from $2', [userId, keepTokenHash ?? null]);
  }

  /** Stores a reset link's token hash; the user's used or expired ones are cleared on the way. */
  async createPasswordReset(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query('delete from password_resets where user_id = $1 and (used_at is not null or expires_at < now())', [userId]);
    await this.pool.query('insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt]);
  }

  /** The user of an unused, unexpired reset link, or null. */
  async passwordResetUser(tokenHash: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      'select u.* from password_resets r join users u on u.id = r.user_id where r.token_hash = $1 and r.used_at is null and r.expires_at > now()',
      [tokenHash],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  /**
   * In one transaction: uses the link (only if still unused and unexpired), sets the password,
   * deletes the user's other links and signs them out everywhere. False when the link was not valid.
   */
  async redeemPasswordReset(tokenHash: string, userId: string, passwordHash: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const used = await client.query(
        'update password_resets set used_at = now() where token_hash = $1 and user_id = $2 and used_at is null and expires_at > now()',
        [tokenHash, userId],
      );
      if (used.rowCount !== 1) {
        await client.query('rollback');
        return false;
      }
      await client.query('update users set password_hash = $2, updated_at = now() where id = $1', [userId, passwordHash]);
      await client.query('delete from password_resets where user_id = $1 and token_hash <> $2', [userId, tokenHash]);
      await client.query('delete from sessions where user_id = $1', [userId]);
      await client.query('commit');
      return true;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
