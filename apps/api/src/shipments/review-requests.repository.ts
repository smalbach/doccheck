import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export type RequestedStatus = 'accepted' | 'false_positive';

export interface ReviewRequest {
  id: string;
  fingerprint: string;
  ruleId: string;
  status: RequestedStatus;
  note: string;
  requestedBy?: { id: string; name: string };
  createdAt: string;
  decision?: 'approved' | 'rejected' | 'withdrawn';
  decidedBy?: { id: string; name: string };
  decisionNote?: string;
  decidedAt?: string;
}

const toRequest = (r: Record<string, unknown>): ReviewRequest => ({
  id: r.id as string,
  fingerprint: r.fingerprint as string,
  ruleId: r.rule_id as string,
  status: r.status as RequestedStatus,
  note: r.note as string,
  ...(r.requested_by ? { requestedBy: { id: r.requested_by as string, name: (r.requester_name as string) ?? '' } } : {}),
  createdAt: new Date(r.created_at as string).toISOString(),
  ...(r.decision ? { decision: r.decision as ReviewRequest['decision'] } : {}),
  ...(r.decided_by ? { decidedBy: { id: r.decided_by as string, name: (r.decider_name as string) ?? '' } } : {}),
  ...(r.decision_note ? { decisionNote: r.decision_note as string } : {}),
  ...(r.decided_at ? { decidedAt: new Date(r.decided_at as string).toISOString() } : {}),
});

const SELECT = `select r.*, a.name as requester_name, b.name as decider_name from review_requests r
  left join users a on a.id = r.requested_by left join users b on b.id = r.decided_by`;

/**
 * Two-step decisions (migration 030): an accepted risk or a false positive waits here for a reviewer
 * who did not ask for it. Approving it records the decision in finding_reviews, in the requester's
 * name with the approver beside it.
 */
@Injectable()
export class ReviewRequestsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Replaces any pending request for the same findings. */
  async create(shipmentId: string, userId: string, findings: { fingerprint: string; ruleId: string }[], status: RequestedStatus, note: string): Promise<string[]> {
    const ids: string[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const f of findings) {
        await client.query(
          `update review_requests set decision = 'withdrawn', decided_by = $3, decided_at = now() where shipment_id = $1 and fingerprint = $2 and decision is null`,
          [shipmentId, f.fingerprint, userId],
        );
        const id = randomUUID();
        await client.query('insert into review_requests (id, shipment_id, fingerprint, rule_id, status, note, requested_by) values ($1, $2, $3, $4, $5, $6, $7)', [
          id,
          shipmentId,
          f.fingerprint,
          f.ruleId,
          status,
          note,
          userId,
        ]);
        ids.push(id);
      }
      await client.query('commit');
      return ids;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** A decision made without approval (back to open, waiting for the supplier) withdraws what was pending. */
  async withdraw(shipmentId: string, fingerprints: string[], userId: string): Promise<void> {
    await this.pool.query(
      `update review_requests set decision = 'withdrawn', decided_by = $3, decided_at = now() where shipment_id = $1 and fingerprint = any($2) and decision is null`,
      [shipmentId, fingerprints, userId],
    );
  }

  async pending(shipmentId: string): Promise<ReviewRequest[]> {
    const { rows } = await this.pool.query(`${SELECT} where r.shipment_id = $1 and r.decision is null order by r.created_at`, [shipmentId]);
    return rows.map(toRequest);
  }

  async find(shipmentId: string, id: string): Promise<ReviewRequest | null> {
    const { rows } = await this.pool.query(`${SELECT} where r.shipment_id = $1 and r.id = $2`, [shipmentId, id]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  /** Pending requests across the organization's shipments, for the approvals queue. */
  async pendingInOrg(orgId: string): Promise<(ReviewRequest & { shipmentId: string; reference?: string })[]> {
    const { rows } = await this.pool.query(
      `${SELECT} join shipments s on s.id = r.shipment_id where s.org_id = $1 and r.decision is null order by r.created_at`,
      [orgId],
    );
    return rows.map((r) => ({ ...toRequest(r), shipmentId: r.shipment_id, ...(r.reference ? { reference: r.reference } : {}) }));
  }

  /**
   * Approves or rejects a pending request; approving also records the decision. Conditional on the
   * request still pending, so two reviewers cannot both decide it. False when it was not pending.
   */
  async decide(id: string, approverId: string, decision: 'approved' | 'rejected', note: string | undefined): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `update review_requests set decision = $3, decided_by = $2, decision_note = $4, decided_at = now()
         where id = $1 and decision is null returning *`,
        [id, approverId, decision, note ?? null],
      );
      const r = rows[0];
      if (!r) {
        await client.query('rollback');
        return false;
      }
      if (decision === 'approved') {
        await client.query(
          'insert into finding_reviews (id, shipment_id, fingerprint, rule_id, status, note, user_id, approved_by) values ($1, $2, $3, $4, $5, $6, $7, $8)',
          [randomUUID(), r.shipment_id, r.fingerprint, r.rule_id, r.status, r.note, r.requested_by, approverId],
        );
      }
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
