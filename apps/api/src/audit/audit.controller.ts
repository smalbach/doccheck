import { Controller, Get, Header, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { csvAttachment, toCsv, type CsvColumn } from '../common/csv';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PG_POOL } from '../db/db.module';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';

export const AuditQuery = z.object({
  action: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(200).optional(),
  entityId: z.string().trim().max(200).optional(),
  userId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export interface AuditRow {
  id: number;
  at: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entity?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  hash: string;
}

const CSV_MAX_ROWS = 50_000;

const COLUMNS: readonly CsvColumn<AuditRow>[] = [
  { header: 'ID', value: (r) => r.id },
  { header: 'Time (UTC)', value: (r) => r.at },
  { header: 'User', value: (r) => r.userEmail },
  { header: 'User ID', value: (r) => r.userId },
  { header: 'Action', value: (r) => r.action },
  { header: 'Entity', value: (r) => r.entity },
  { header: 'Entity ID', value: (r) => r.entityId },
  { header: 'Before', value: (r) => (r.before === undefined ? undefined : JSON.stringify(r.before)) },
  { header: 'After', value: (r) => (r.after === undefined ? undefined : JSON.stringify(r.after)) },
  { header: 'IP', value: (r) => r.ip },
  { header: 'Hash', value: (r) => r.hash },
];

/** The organization's audit log (owners and admins): filtered pages, CSV export, and a check of the hash chain. */
@Controller('audit')
@Permission('audit.read')
export class AuditController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async find(orgId: string, q: AuditQuery): Promise<{ items: AuditRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const where = ['org_id = $1'];
    const add = (sql: (n: number) => string, value: unknown) => {
      params.push(value);
      where.push(sql(params.length));
    };
    if (q.action) add((n) => `action like $${n}`, `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (q.entity) add((n) => `entity = $${n}`, q.entity);
    if (q.entityId) add((n) => `entity_id = $${n}`, q.entityId);
    if (q.userId) add((n) => `user_id = $${n}`, q.userId);
    if (q.from) add((n) => `at >= $${n}::date`, q.from);
    if (q.to) add((n) => `at < $${n}::date + 1`, q.to);
    if (q.q) add((n) => `(coalesce(user_email, '') || ' ' || action || ' ' || coalesce(entity, '') || ' ' || coalesce(entity_id, '') || ' ' || coalesce(after::text, '') || ' ' || coalesce(before::text, '')) ilike $${n}`, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    params.push(q.limit, q.offset);
    const { rows } = await this.pool.query(
      `select *, count(*) over ()::int as total from audit_log where ${where.join(' and ')} order by id desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return {
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({
        id: Number(r.id),
        at: new Date(r.at).toISOString(),
        ...(r.user_id ? { userId: r.user_id } : {}),
        ...(r.user_email ? { userEmail: r.user_email } : {}),
        action: r.action,
        ...(r.entity ? { entity: r.entity } : {}),
        ...(r.entity_id ? { entityId: r.entity_id } : {}),
        ...(r.before !== null ? { before: r.before } : {}),
        ...(r.after !== null ? { after: r.after } : {}),
        ...(r.ip ? { ip: r.ip } : {}),
        hash: r.hash,
      })),
    };
  }

  /** ?action=finding.&entity=&entityId=&userId=&q=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=&offset=, newest first. */
  @Get()
  async list(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AuditQuery)) q: AuditQuery) {
    return { ...(await this.find(org.id, q)), limit: q.limit, offset: q.offset };
  }

  /** The rows the filters match (up to 50,000), as CSV. */
  @Get('log.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async csv(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AuditQuery.omit({ limit: true, offset: true }))) q: AuditQuery, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.find(org.id, { ...q, limit: CSV_MAX_ROWS, offset: 0 });
    res.setHeader('content-disposition', csvAttachment('doccheck-audit'));
    return toCsv(COLUMNS, items);
  }

  /**
   * Recomputes every row's hash and checks each row names the one before it. `firstBroken` is the
   * first row edited, removed after, or inserted out of the chain; null when the log is intact.
   */
  @Get('verify')
  async verify(@CurrentOrg() org: OrgContext) {
    const { rows } = await this.pool.query(
      `with chain as (
         select id, hash, prev_hash,
           encode(sha256(convert_to(dc_audit_payload(a), 'UTF8')), 'hex') as computed,
           coalesce(lag(hash) over (order by id), repeat('0', 64)) as expected_prev
         from audit_log a where org_id = $1
       )
       select count(*)::int as rows, min(id) filter (where hash <> computed or prev_hash <> expected_prev) as first_broken from chain`,
      [org.id],
    );
    return { rows: rows[0].rows, intact: rows[0].first_broken === null, firstBroken: rows[0].first_broken === null ? null : Number(rows[0].first_broken) };
  }
}
