import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PublicUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import type { OrgContext } from '../orgs/org.types';
import { can, type OrgRole } from '../orgs/permissions';
import { ReviewRequestsRepository } from '../shipments/review-requests.repository';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import type { ApprovalDto, CommentsQuery, EditCommentDto, NewCommentDto, ScheduleDto } from './collab.dto';
import { NotificationsService } from './notifications.service';

export interface Comment {
  id: string;
  targetKind: 'shipment' | 'finding' | 'document';
  targetId: string;
  author?: { id: string; name: string };
  body: string;
  mentions: { id: string; name: string }[];
  createdAt: string;
  editedAt?: string;
  deleted: boolean;
}

/** Roles that work on findings, so they can be assigned one. */
const ASSIGNABLE: readonly OrgRole[] = ['owner', 'admin', 'analyst', 'reviewer'];
const excerpt = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

/**
 * Teamwork on a shipment: who works it and its findings, comments with @mentions on the shipment,
 * a finding or a document, the due date, and approvals of accepted risks and false positives.
 */
@Injectable()
export class CollabService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly shipments: ShipmentsRepository,
    private readonly requests: ReviewRequestsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Members of `orgId` among `ids`, with their roles. */
  private async members(orgId: string, ids: string[]): Promise<Map<string, { name: string; role: OrgRole }>> {
    if (!ids.length) return new Map();
    const { rows } = await this.pool.query(
      'select m.user_id, u.name, m.role from org_members m join users u on u.id = m.user_id where m.org_id = $1 and m.user_id = any($2::uuid[])',
      [orgId, ids],
    );
    return new Map(rows.map((r) => [r.user_id, { name: r.name, role: r.role }]));
  }

  private async assignable(orgId: string, userId: string) {
    const m = (await this.members(orgId, [userId])).get(userId);
    if (!m || !ASSIGNABLE.includes(m.role)) throw new BadRequestException('Assign to a member who works on findings (owner, admin, analyst or reviewer)');
  }

  /** Everything the shipment page shows about teamwork, in one call. */
  async summary(shipmentId: string, org: OrgContext) {
    const [{ rows: [s] }, { rows: assigned }, pendingApprovals, { rows: counts }] = await Promise.all([
      this.pool.query(
        `select s.eta, s.due_at as manual_due, d.due_at, d.due_source, s.assignee_id, u.name as assignee_name, o.require_approval
         from shipments s join shipment_due d on d.shipment_id = s.id left join users u on u.id = s.assignee_id join organizations o on o.id = s.org_id where s.id = $1`,
        [shipmentId],
      ),
      this.pool.query('select a.fingerprint, a.assignee_id, u.name from finding_assignments a join users u on u.id = a.assignee_id where a.shipment_id = $1', [shipmentId]),
      this.requests.pending(shipmentId),
      this.pool.query(
        `select target_kind, target_id, count(*)::int as n from comments where shipment_id = $1 and deleted_at is null group by 1, 2`,
        [shipmentId],
      ),
    ]);
    return {
      ...(s.assignee_id ? { assignee: { id: s.assignee_id, name: s.assignee_name } } : {}),
      ...(s.eta ? { eta: (s.eta as Date).toISOString().slice(0, 10) } : {}),
      ...(s.manual_due ? { manualDueAt: new Date(s.manual_due).toISOString() } : {}),
      ...(s.due_at ? { due: { at: new Date(s.due_at).toISOString(), source: s.due_source } } : {}),
      requireApproval: s.require_approval as boolean,
      findingAssignees: Object.fromEntries(assigned.map((a) => [a.fingerprint, { id: a.assignee_id, name: a.name }])),
      // A client sees decisions, not the team's queue.
      pendingApprovals: org.role === 'client' ? [] : pendingApprovals,
      commentCounts: org.role === 'client' ? {} : Object.fromEntries(counts.map((c) => [`${c.target_kind}:${c.target_id}`, c.n])),
    };
  }

  async assignShipment(shipmentId: string, org: OrgContext, actor: PublicUser, userId: string | null) {
    if (userId) await this.assignable(org.id, userId);
    const { rows } = await this.pool.query('select assignee_id from shipments where id = $1', [shipmentId]);
    await this.pool.query('update shipments set assignee_id = $2 where id = $1', [shipmentId, userId]);
    this.audit.note({ action: 'shipment.assign', entity: 'shipment', entityId: shipmentId, before: { assignee: rows[0]?.assignee_id ?? null }, after: { assignee: userId } });
    if (userId) await this.notifications.notify({ userIds: [userId], kind: 'assignment', orgId: org.id, shipmentId, actorId: actor.id, detail: { target: 'shipment' } });
    return this.summary(shipmentId, org);
  }

  async assignFindings(shipmentId: string, org: OrgContext, actor: PublicUser, fingerprints: string[], userId: string | null) {
    const latest = new Set((await this.shipments.latestFindings(shipmentId)).map((f) => f.fingerprint));
    const unknown = fingerprints.filter((fp) => !latest.has(fp));
    if (unknown.length) throw new BadRequestException(`Not findings of the latest validation: ${unknown.join(', ')}`);
    if (userId) await this.assignable(org.id, userId);
    const { rows: before } = await this.pool.query('select fingerprint, assignee_id from finding_assignments where shipment_id = $1 and fingerprint = any($2)', [shipmentId, fingerprints]);
    if (userId) {
      await this.pool.query(
        `insert into finding_assignments (shipment_id, fingerprint, assignee_id, assigned_by) select $1, unnest($2::text[]), $3, $4
         on conflict (shipment_id, fingerprint) do update set assignee_id = excluded.assignee_id, assigned_by = excluded.assigned_by, created_at = now()`,
        [shipmentId, fingerprints, userId, actor.id],
      );
    } else {
      await this.pool.query('delete from finding_assignments where shipment_id = $1 and fingerprint = any($2)', [shipmentId, fingerprints]);
    }
    this.audit.note({
      action: 'finding.assign',
      entity: 'shipment',
      entityId: shipmentId,
      before: Object.fromEntries(before.map((b) => [b.fingerprint, b.assignee_id])),
      after: { fingerprints, assignee: userId },
    });
    if (userId) await this.notifications.notify({ userIds: [userId], kind: 'assignment', orgId: org.id, shipmentId, actorId: actor.id, detail: { target: 'finding', count: fingerprints.length } });
    return this.summary(shipmentId, org);
  }

  async schedule(shipmentId: string, org: OrgContext, dto: ScheduleDto) {
    const { rows } = await this.pool.query('select eta, due_at from shipments where id = $1', [shipmentId]);
    const sets: string[] = [];
    const params: unknown[] = [shipmentId];
    if (dto.eta !== undefined) {
      params.push(dto.eta);
      sets.push(`eta = $${params.length}`);
    }
    if (dto.dueAt !== undefined) {
      params.push(dto.dueAt);
      sets.push(`due_at = $${params.length}`);
    }
    if (sets.length) await this.pool.query(`update shipments set ${sets.join(', ')} where id = $1`, params);
    this.audit.note({
      action: 'shipment.schedule',
      entity: 'shipment',
      entityId: shipmentId,
      before: { eta: rows[0]?.eta ? (rows[0].eta as Date).toISOString().slice(0, 10) : null, dueAt: rows[0]?.due_at ?? null },
      after: dto,
    });
    return this.summary(shipmentId, org);
  }

  // Comments --------------------------------------------------------------------------------------

  async comments(shipmentId: string, q: CommentsQuery): Promise<Comment[]> {
    const { rows } = await this.pool.query(
      `select c.*, u.name as author_name,
         (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name)), '[]') from users m where m.id = any(c.mentions)) as mentioned
       from comments c left join users u on u.id = c.user_id
       where c.shipment_id = $1 and ($2::text is null or c.target_kind = $2) and ($3::text is null or c.target_id = $3)
       order by c.created_at, c.id`,
      [shipmentId, q.targetKind ?? null, q.targetId ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      targetKind: r.target_kind,
      targetId: r.target_id,
      ...(r.user_id ? { author: { id: r.user_id, name: r.author_name ?? '' } } : {}),
      body: r.deleted_at ? '' : r.body,
      mentions: r.deleted_at ? [] : r.mentioned,
      createdAt: new Date(r.created_at).toISOString(),
      ...(r.edited_at ? { editedAt: new Date(r.edited_at).toISOString() } : {}),
      deleted: r.deleted_at !== null,
    }));
  }

  private async checkTarget(shipmentId: string, dto: NewCommentDto) {
    if (dto.targetKind === 'document') {
      const { rowCount } = await this.pool.query('select 1 from documents where id = $1 and shipment_id = $2', [dto.targetId, shipmentId]);
      if (!rowCount) throw new BadRequestException('Not a document of this shipment');
    }
    if (dto.targetKind === 'finding') {
      const { rowCount } = await this.pool.query('select 1 from findings where shipment_id = $1 and fingerprint = $2 limit 1', [shipmentId, dto.targetId]);
      if (!rowCount) throw new BadRequestException('Not a finding of this shipment');
    }
  }

  /** Who a comment mentions: members who can read the shipment (a client only if it is shared with them). */
  private async mentionable(shipmentId: string, orgId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const { rows } = await this.pool.query(
      `select m.user_id from org_members m where m.org_id = $1 and m.user_id = any($2::uuid[])
         and (m.role <> 'client' or exists (select 1 from shipment_shares s where s.shipment_id = $3 and s.user_id = m.user_id))`,
      [orgId, ids, shipmentId],
    );
    return rows.map((r) => r.user_id);
  }

  async addComment(shipmentId: string, org: OrgContext, actor: PublicUser, dto: NewCommentDto): Promise<Comment[]> {
    await this.checkTarget(shipmentId, dto);
    const mentions = await this.mentionable(shipmentId, org.id, [...new Set(dto.mentions)]);
    const id = randomUUID();
    await this.pool.query(
      'insert into comments (id, org_id, shipment_id, target_kind, target_id, user_id, body, mentions) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, org.id, shipmentId, dto.targetKind, dto.targetId ?? '', actor.id, dto.body, mentions],
    );
    this.audit.note({ action: 'comment.create', entity: 'comment', entityId: id, after: { shipmentId, targetKind: dto.targetKind, targetId: dto.targetId, body: dto.body, mentions } });
    await this.notifications.notify({
      userIds: mentions,
      kind: 'mention',
      orgId: org.id,
      shipmentId,
      actorId: actor.id,
      detail: { commentId: id, targetKind: dto.targetKind, targetId: dto.targetId, excerpt: excerpt(dto.body) },
    });
    return this.comments(shipmentId, { targetKind: dto.targetKind, targetId: dto.targetId ?? '' });
  }

  private async ownComment(shipmentId: string, id: string, actor: PublicUser, org: OrgContext, allowModerator: boolean) {
    const { rows } = await this.pool.query('select * from comments where id = $1 and shipment_id = $2 and deleted_at is null', [id, shipmentId]);
    const c = rows[0];
    if (!c) throw new NotFoundException('Comment not found');
    if (c.user_id !== actor.id && !(allowModerator && can(org.role, 'members.manage'))) throw new ForbiddenException('Only the author can change this comment');
    return c;
  }

  async editComment(shipmentId: string, org: OrgContext, actor: PublicUser, id: string, dto: EditCommentDto) {
    const c = await this.ownComment(shipmentId, id, actor, org, false);
    const mentions = await this.mentionable(shipmentId, org.id, [...new Set(dto.mentions)]);
    await this.pool.query('update comments set body = $2, mentions = $3, edited_at = now() where id = $1', [id, dto.body, mentions]);
    this.audit.note({ action: 'comment.edit', entity: 'comment', entityId: id, before: { body: c.body }, after: { body: dto.body } });
    const added = mentions.filter((m) => !(c.mentions as string[]).includes(m));
    await this.notifications.notify({ userIds: added, kind: 'mention', orgId: org.id, shipmentId, actorId: actor.id, detail: { commentId: id, targetKind: c.target_kind, targetId: c.target_id, excerpt: excerpt(dto.body) } });
    return this.comments(shipmentId, { targetKind: c.target_kind, targetId: c.target_id });
  }

  /** The author, or an owner or admin, removes a comment: its text goes, a placeholder stays in the thread. */
  async deleteComment(shipmentId: string, org: OrgContext, actor: PublicUser, id: string) {
    const c = await this.ownComment(shipmentId, id, actor, org, true);
    await this.pool.query('update comments set deleted_at = now() where id = $1', [id]);
    this.audit.note({ action: 'comment.delete', entity: 'comment', entityId: id, before: { body: c.body, author: c.user_id } });
  }

  // Approvals -------------------------------------------------------------------------------------

  pendingApprovals(org: OrgContext) {
    return this.requests.pendingInOrg(org.id);
  }

  /**
   * A reviewer (owner, admin or reviewer) approves or rejects someone else's accepted risk or false
   * positive. Nobody approves their own request: that is the point of two steps.
   */
  async decide(shipmentId: string, org: OrgContext, actor: PublicUser, requestId: string, dto: ApprovalDto) {
    const request = await this.requests.find(shipmentId, requestId);
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.decision) throw new ConflictException('This request was already decided');
    if (request.requestedBy?.id === actor.id) throw new ForbiddenException('Someone else must approve your own request');
    if (!(await this.requests.decide(requestId, actor.id, dto.decision, dto.note))) throw new ConflictException('This request was already decided');
    this.audit.note({
      action: `finding.${dto.decision === 'approved' ? 'approve' : 'reject'}`,
      entity: 'shipment',
      entityId: shipmentId,
      before: { request: requestId, fingerprint: request.fingerprint, status: request.status, requestedBy: request.requestedBy?.id },
      after: { decision: dto.decision, note: dto.note },
    });
    if (request.requestedBy) {
      await this.notifications.notify({
        userIds: [request.requestedBy.id],
        kind: 'approval_decided',
        orgId: org.id,
        shipmentId,
        actorId: actor.id,
        detail: { decision: dto.decision, status: request.status, excerpt: dto.note },
      });
    }
    return this.summary(shipmentId, org);
  }
}
