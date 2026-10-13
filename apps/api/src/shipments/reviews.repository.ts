import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { FindingReview, ReviewStatus } from './reviews.types';

/** Decisions about findings (migration 014). */
@Injectable()
export class FindingReviewsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Every decision on the shipment's findings, per fingerprint, newest first. */
  async history(shipmentId: string): Promise<Map<string, FindingReview[]>> {
    const { rows } = await this.pool.query(
      `select r.fingerprint, r.status, r.note, r.created_at, u.name as user_name
       from finding_reviews r left join users u on u.id = r.user_id
       where r.shipment_id = $1 order by r.created_at desc, r.id`,
      [shipmentId],
    );
    const byFingerprint = new Map<string, FindingReview[]>();
    for (const r of rows) {
      const list = byFingerprint.get(r.fingerprint) ?? [];
      list.push({ status: r.status, ...(r.note ? { note: r.note } : {}), ...(r.user_name ? { userName: r.user_name } : {}), at: new Date(r.created_at).toISOString() });
      byFingerprint.set(r.fingerprint, list);
    }
    return byFingerprint;
  }

  async save(shipmentId: string, userId: string, findings: { fingerprint: string; ruleId: string }[], status: ReviewStatus, note: string | undefined): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const f of findings) {
        await client.query(
          'insert into finding_reviews (id, shipment_id, fingerprint, rule_id, status, note, user_id) values ($1, $2, $3, $4, $5, $6, $7)',
          [randomUUID(), shipmentId, f.fingerprint, f.ruleId, status, note ?? null, userId],
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** The run before `validationId`, if any. */
  async previousValidation(shipmentId: string, validationId: string): Promise<{ id: string; createdAt: string } | null> {
    const { rows } = await this.pool.query(
      `select id, created_at from validations
       where shipment_id = $1 and (created_at, id) < (select created_at, id from validations where id = $2)
       order by created_at desc, id desc limit 1`,
      [shipmentId, validationId],
    );
    return rows[0] ? { id: rows[0].id, createdAt: new Date(rows[0].created_at).toISOString() } : null;
  }
}
