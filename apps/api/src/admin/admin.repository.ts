import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Role } from '../auth/auth.types';
import { PG_POOL } from '../db/db.module';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  shipmentCount: number;
}

@Injectable()
export class AdminRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async users(): Promise<UserSummary[]> {
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.name, u.role, u.created_at, (select count(*)::int from shipments s where s.user_id = u.id) as shipment_count
       from users u order by u.created_at`,
    );
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: new Date(r.created_at).toISOString(), shipmentCount: r.shipment_count }));
  }

  /**
   * Changes a user's role unless that would leave no admin. The admin rows are locked so two
   * admins demoting each other at once cannot both succeed.
   */
  async setRole(id: string, role: Role): Promise<'ok' | 'not-found' | 'last-admin'> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const admins = await client.query<{ id: string }>("select id from users where role = 'admin' for update");
      const target = await client.query('select 1 from users where id = $1', [id]);
      if (!target.rowCount) {
        await client.query('rollback');
        return 'not-found';
      }
      if (role === 'user' && admins.rows.length === 1 && admins.rows[0]!.id === id) {
        await client.query('rollback');
        return 'last-admin';
      }
      await client.query('update users set role = $2, updated_at = now() where id = $1', [id, role]);
      await client.query('commit');
      return 'ok';
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async counts(): Promise<{ users: number; shipments: number; documents: number; validations: number }> {
    const { rows } = await this.pool.query(
      `select (select count(*)::int from users) as users, (select count(*)::int from shipments) as shipments,
              (select count(*)::int from documents) as documents, (select count(*)::int from validations) as validations`,
    );
    return rows[0];
  }
}
