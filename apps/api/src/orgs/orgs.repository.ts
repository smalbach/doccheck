import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { Invite, Member, OrgContext, OrgSettings } from './org.types';
import type { OrgRole } from './permissions';

const toContext = (r: Record<string, unknown>): OrgContext => ({ id: r.id as string, name: r.name as string, personal: r.personal as boolean, role: r.role as OrgRole });

const toSettings = (r: Record<string, unknown>): OrgSettings => ({
  name: r.name as string,
  retentionCaYears: r.retention_ca_years as number,
  retentionUsYears: r.retention_us_years as number,
  requireApproval: r.require_approval as boolean,
  slaEtaLeadHours: r.sla_eta_lead_hours as number,
});

/** Organizations, members, invitations and shares (migration 040). */
@Injectable()
export class OrgsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The user's membership in `orgId`, or null when they are not a member. */
  async membership(userId: string, orgId: string): Promise<OrgContext | null> {
    const { rows } = await this.pool.query(
      'select o.id, o.name, o.personal, m.role from org_members m join organizations o on o.id = m.org_id where m.user_id = $1 and m.org_id = $2',
      [userId, orgId],
    );
    return rows[0] ? toContext(rows[0]) : null;
  }

  /** The organization a session works in: its own, else the user's last one, else their oldest membership. */
  async activeMembership(userId: string, sessionOrgId: string | null): Promise<OrgContext | null> {
    const { rows } = await this.pool.query(
      `select o.id, o.name, o.personal, m.role from org_members m join organizations o on o.id = m.org_id join users u on u.id = m.user_id
       where m.user_id = $1
       order by (o.id = $2) desc nulls last, (o.id = u.last_org_id) desc nulls last, o.personal desc, m.created_at limit 1`,
      [userId, sessionOrgId],
    );
    return rows[0] ? toContext(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<(OrgContext & { members: number })[]> {
    const { rows } = await this.pool.query(
      `select o.id, o.name, o.personal, m.role, (select count(*)::int from org_members x where x.org_id = o.id) as members
       from org_members m join organizations o on o.id = m.org_id where m.user_id = $1 order by o.personal desc, lower(o.name)`,
      [userId],
    );
    return rows.map((r) => ({ ...toContext(r), members: r.members }));
  }

  /** A new organization with `userId` as owner. */
  async create(userId: string, name: string, personal: boolean, db: Pool | PoolClient = this.pool): Promise<string> {
    const id = randomUUID();
    await db.query('insert into organizations (id, name, personal, created_by) values ($1, $2, $3, $4)', [id, name, personal, userId]);
    await db.query(`insert into org_members (org_id, user_id, role) values ($1, $2, 'owner')`, [id, userId]);
    return id;
  }

  /** Where the user works now: kept on the session and as the user's default for new sessions and intake mail. */
  async switchTo(userId: string, orgId: string, sessionTokenHash: string | undefined): Promise<void> {
    await this.pool.query('update users set last_org_id = $2 where id = $1', [userId, orgId]);
    if (sessionTokenHash) await this.pool.query('update sessions set org_id = $2 where token_hash = $1', [sessionTokenHash, orgId]);
  }

  async settings(orgId: string): Promise<OrgSettings | null> {
    const { rows } = await this.pool.query('select * from organizations where id = $1', [orgId]);
    return rows[0] ? toSettings(rows[0]) : null;
  }

  async updateSettings(orgId: string, patch: Partial<OrgSettings>): Promise<OrgSettings> {
    const columns: Record<keyof OrgSettings, string> = {
      name: 'name',
      retentionCaYears: 'retention_ca_years',
      retentionUsYears: 'retention_us_years',
      requireApproval: 'require_approval',
      slaEtaLeadHours: 'sla_eta_lead_hours',
    };
    const entries = (Object.keys(columns) as (keyof OrgSettings)[]).filter((k) => patch[k] !== undefined);
    if (entries.length) {
      await this.pool.query(
        `update organizations set ${entries.map((k, i) => `${columns[k]} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`,
        [orgId, ...entries.map((k) => patch[k])],
      );
    }
    return (await this.settings(orgId))!;
  }

  async members(orgId: string): Promise<Member[]> {
    const { rows } = await this.pool.query(
      `select m.user_id, u.email, u.name, m.role, m.created_at, u.mfa_enabled_at is not null as mfa
       from org_members m join users u on u.id = m.user_id where m.org_id = $1
       order by array_position(array['owner', 'admin', 'analyst', 'reviewer', 'viewer', 'client'], m.role), lower(u.name)`,
      [orgId],
    );
    return rows.map((r) => ({ userId: r.user_id, email: r.email, name: r.name, role: r.role, mfa: r.mfa, joinedAt: new Date(r.created_at).toISOString() }));
  }

  async memberRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const { rows } = await this.pool.query('select role from org_members where org_id = $1 and user_id = $2', [orgId, userId]);
    return rows[0]?.role ?? null;
  }

  async addMember(orgId: string, userId: string, role: OrgRole, db: Pool | PoolClient = this.pool): Promise<void> {
    await db.query('insert into org_members (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do nothing', [orgId, userId, role]);
  }

  /**
   * Changes a role, or removes the member (role null), unless that would leave the organization
   * without an owner. Locks the members so two admins cannot demote the last two owners at once.
   */
  async setRole(orgId: string, userId: string, role: OrgRole | null): Promise<'ok' | 'not-found' | 'last-owner'> {
    return this.transaction(async (db) => {
      const { rows } = await db.query<{ user_id: string; role: OrgRole }>('select user_id, role from org_members where org_id = $1 for update', [orgId]);
      const current = rows.find((r) => r.user_id === userId);
      if (!current) return 'not-found';
      const owners = rows.filter((r) => r.role === 'owner').length;
      if (current.role === 'owner' && role !== 'owner' && owners <= 1) return 'last-owner';
      if (role) await db.query('update org_members set role = $3 where org_id = $1 and user_id = $2', [orgId, userId, role]);
      else {
        await db.query('delete from org_members where org_id = $1 and user_id = $2', [orgId, userId]);
        await db.query('delete from shipment_shares s using shipments x where x.id = s.shipment_id and x.org_id = $1 and s.user_id = $2', [orgId, userId]);
        await db.query('delete from finding_assignments a using shipments x where x.id = a.shipment_id and x.org_id = $1 and a.assignee_id = $2', [orgId, userId]);
        await db.query('update shipments set assignee_id = null where org_id = $1 and assignee_id = $2', [orgId, userId]);
        await db.query('update sessions set org_id = null where user_id = $2 and org_id = $1', [orgId, userId]);
        await db.query('update users set last_org_id = null where id = $2 and last_org_id = $1', [orgId, userId]);
      }
      return 'ok';
    });
  }

  async deleteOrg(orgId: string): Promise<{ keys: string[] } | 'pending'> {
    return this.transaction(async (db) => {
      await db.query('select 1 from shipments where org_id = $1 for update', [orgId]);
      const docs = await db.query<{ storage_key: string; status: string }>(
        'select d.storage_key, d.status from documents d join shipments s on s.id = d.shipment_id where s.org_id = $1',
        [orgId],
      );
      if (docs.rows.some((r) => r.status === 'QUEUED' || r.status === 'EXTRACTING')) return 'pending';
      await db.query('delete from organizations where id = $1', [orgId]);
      return { keys: docs.rows.map((r) => r.storage_key) };
    });
  }

  // Invitations -----------------------------------------------------------------------------------

  async createInvite(i: { orgId: string; email: string; role: OrgRole; tokenHash: string; invitedBy: string; expiresAt: Date }): Promise<string> {
    const id = randomUUID();
    // A new invitation to the same address replaces the pending one.
    await this.pool.query('delete from org_invites where org_id = $1 and email = $2 and accepted_at is null', [i.orgId, i.email]);
    await this.pool.query(
      'insert into org_invites (id, org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, i.orgId, i.email, i.role, i.tokenHash, i.invitedBy, i.expiresAt],
    );
    return id;
  }

  async invites(orgId: string): Promise<Invite[]> {
    const { rows } = await this.pool.query(
      `select i.*, u.name as invited_by_name from org_invites i left join users u on u.id = i.invited_by
       where i.org_id = $1 and i.accepted_at is null and i.expires_at > now() order by i.created_at desc`,
      [orgId],
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      ...(r.invited_by_name ? { invitedBy: r.invited_by_name } : {}),
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
    }));
  }

  async deleteInvite(orgId: string, id: string): Promise<boolean> {
    const res = await this.pool.query('delete from org_invites where org_id = $1 and id = $2 and accepted_at is null', [orgId, id]);
    return res.rowCount === 1;
  }

  /** What a pending invitation link offers, for the page that accepts it. */
  async inviteByToken(tokenHash: string): Promise<{ id: string; orgId: string; orgName: string; email: string; role: OrgRole } | null> {
    const { rows } = await this.pool.query(
      `select i.id, i.org_id, o.name, i.email, i.role from org_invites i join organizations o on o.id = i.org_id
       where i.token_hash = $1 and i.accepted_at is null and i.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ? { id: rows[0].id, orgId: rows[0].org_id, orgName: rows[0].name, email: rows[0].email, role: rows[0].role } : null;
  }

  /** Uses the invitation once and adds the member (a current member keeps their role). */
  async acceptInvite(inviteId: string, userId: string): Promise<boolean> {
    return this.transaction(async (db) => {
      const used = await db.query<{ org_id: string; role: OrgRole }>(
        'update org_invites set accepted_at = now(), accepted_by = $2 where id = $1 and accepted_at is null and expires_at > now() returning org_id, role',
        [inviteId, userId],
      );
      if (!used.rows[0]) return false;
      await this.addMember(used.rows[0].org_id, userId, used.rows[0].role, db);
      return true;
    });
  }

  // Shipments shared with clients ----------------------------------------------------------------

  async shares(shipmentId: string): Promise<{ userId: string; name: string; email: string }[]> {
    const { rows } = await this.pool.query(
      'select u.id, u.name, u.email from shipment_shares s join users u on u.id = s.user_id where s.shipment_id = $1 order by lower(u.name)',
      [shipmentId],
    );
    return rows.map((r) => ({ userId: r.id, name: r.name, email: r.email }));
  }

  async share(shipmentId: string, userId: string, sharedBy: string): Promise<void> {
    await this.pool.query('insert into shipment_shares (shipment_id, user_id, shared_by) values ($1, $2, $3) on conflict do nothing', [shipmentId, userId, sharedBy]);
  }

  async unshare(shipmentId: string, userId: string): Promise<void> {
    await this.pool.query('delete from shipment_shares where shipment_id = $1 and user_id = $2', [shipmentId, userId]);
  }

  /**
   * Whether the shipment is in the organization and, for a client, shared with them. The single
   * check behind every shipment route (ShipmentOwnerGuard) and every service that takes a shipment id.
   */
  async canSeeShipment(shipmentId: string, org: OrgContext, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `select 1 from shipments s where s.id = $1 and s.org_id = $2
         and ($3 <> 'client' or exists (select 1 from shipment_shares x where x.shipment_id = s.id and x.user_id = $4))`,
      [shipmentId, org.id, org.role, userId],
    );
    return rowCount === 1;
  }

  async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
