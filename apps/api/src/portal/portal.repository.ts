import { Inject, Injectable } from '@nestjs/common';
import type { DocumentType } from '@doccheck/schemas';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { PortalEventKind, PortalKind, PortalLinkRow, PortalRequestRow, PortalUploadView } from './portal.types';

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : undefined);

/**
 * A request with what its status is made of. "open" counts the latest validation's findings that
 * concern the supplier: every finding of a pre-shipment draft; for a correction, the findings asked
 * about and any finding citing a document the supplier uploaded.
 */
const REQUEST_SELECT = `
  select r.*, o.name as org_name, s.reference as shipment_reference, s.destination, p.name as party_name,
    (select count(*) from portal_uploads u where u.request_id = r.id and u.status in ('extracting', 'validating'))::int as pending,
    (select count(*) from portal_uploads u where u.request_id = r.id)::int as uploads,
    (select u.status from portal_uploads u where u.request_id = r.id order by u.created_at desc limit 1) as last_upload_status,
    coalesce(lv.created_at > r.created_at, false) as validated_since,
    (select count(*) from findings f where f.validation_id = lv.id and (
      r.kind = 'pre_shipment' or f.fingerprint = any(r.fingerprints)
      or exists (select 1 from jsonb_array_elements(f.evidence) ev join portal_uploads u on u.request_id = r.id where (ev->>'documentId') = any(u.document_ids::text[]))
    ))::int as open,
    (select max(e.created_at) from portal_events e where e.request_id = r.id and e.kind <> 'denied') as last_activity_at
  from portal_requests r
  join organizations o on o.id = r.org_id
  join shipments s on s.id = r.shipment_id
  left join parties p on p.id = r.party_id
  left join lateral (select v.id, v.created_at from validations v where v.shipment_id = r.shipment_id order by v.created_at desc limit 1) lv on true`;

const toRequest = (r: Record<string, unknown>): PortalRequestRow => ({
  id: r.id as string,
  orgId: r.org_id as string,
  orgName: r.org_name as string,
  ...(r.user_id ? { userId: r.user_id as string } : {}),
  kind: r.kind as PortalKind,
  shipmentId: r.shipment_id as string,
  ...(r.party_id ? { partyId: r.party_id as string } : {}),
  ...(r.party_name || r.supplier_name ? { supplierName: (r.party_name ?? r.supplier_name) as string } : {}),
  ...(r.thread_id ? { threadId: r.thread_id as string } : {}),
  ...(r.reference ? { reference: r.reference as string } : {}),
  ...(r.shipment_reference ? { shipmentReference: r.shipment_reference as string } : {}),
  ...(r.destination ? { destination: r.destination as string } : {}),
  ...(r.language ? { language: r.language as string } : {}),
  fingerprints: (r.fingerprints as string[]) ?? [],
  createdAt: iso(r.created_at)!,
  ...(r.closed_at ? { closedAt: iso(r.closed_at) } : {}),
  pending: r.pending as number,
  uploads: r.uploads as number,
  ...(r.last_upload_status ? { lastUploadStatus: r.last_upload_status as PortalRequestRow['lastUploadStatus'] } : {}),
  open: r.open as number,
  validatedSince: r.validated_since as boolean,
  ...(r.last_activity_at ? { lastActivityAt: iso(r.last_activity_at) } : {}),
});

const toLink = (r: Record<string, unknown>): PortalLinkRow => ({
  id: r.id as string,
  requestId: r.request_id as string,
  tokenHash: r.token_hash as Buffer,
  expiresAt: iso(r.expires_at)!,
  ...(r.revoked_at ? { revokedAt: iso(r.revoked_at) } : {}),
  ...(r.last_used_at ? { lastUsedAt: iso(r.last_used_at) } : {}),
  createdAt: iso(r.created_at)!,
});

export interface NewPortalRequest {
  id: string;
  orgId: string;
  userId: string;
  kind: PortalKind;
  shipmentId: string;
  partyId?: string;
  supplierName?: string;
  threadId?: string;
  reference?: string;
  language?: string;
  fingerprints: string[];
}

/** One document of a shipment, for showing a finding's values to a supplier. */
export interface PortalDocumentMeta {
  id: string;
  type: DocumentType;
  sellerId?: string;
}

/** All SQL of the supplier portal. */
@Injectable()
export class PortalRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    return (async () => {
      const db = await this.pool.connect();
      try {
        await db.query('begin');
        const out = await work(db);
        await db.query('commit');
        return out;
      } catch (err) {
        await db.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        db.release();
      }
    })();
  }

  // Requests ----------------------------------------------------------------------------------------

  async insertRequest(r: NewPortalRequest, db: PoolClient | Pool = this.pool): Promise<void> {
    await db.query(
      `insert into portal_requests (id, org_id, user_id, kind, shipment_id, party_id, supplier_name, thread_id, reference, language, fingerprints)
       values ($1, $11, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, r.userId, r.kind, r.shipmentId, r.partyId ?? null, r.supplierName ?? null, r.threadId ?? null, r.reference ?? null, r.language ?? null, r.fingerprints, r.orgId],
    );
  }

  async request(id: string): Promise<PortalRequestRow | null> {
    const { rows } = await this.pool.query(`${REQUEST_SELECT} where r.id = $1`, [id]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listRequests(orgId: string, q: { partyId?: string; threadId?: string; shipmentId?: string; kind?: PortalKind; limit: number; offset: number }) {
    const params: unknown[] = [orgId];
    const where = ['r.org_id = $1'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.partyId) add('r.party_id = ?', q.partyId);
    if (q.threadId) add('r.thread_id = ?', q.threadId);
    if (q.shipmentId) add('r.shipment_id = ?', q.shipmentId);
    if (q.kind) add('r.kind = ?', q.kind);
    const { rows: [count] } = await this.pool.query(`select count(*)::int as n from portal_requests r where ${where.join(' and ')}`, params);
    params.push(q.limit, q.offset);
    const { rows } = await this.pool.query(`${REQUEST_SELECT} where ${where.join(' and ')} order by r.created_at desc limit $${params.length - 1} offset $${params.length}`, params);
    return { items: rows.map(toRequest), total: count.n as number };
  }

  /** The supplier's requests from the same organization (same company), newest first. */
  async history(orgId: string, partyId: string, limit = 20): Promise<PortalRequestRow[]> {
    const { rows } = await this.pool.query(`${REQUEST_SELECT} where r.org_id = $1 and r.party_id = $2 order by r.created_at desc limit $3`, [orgId, partyId, limit]);
    return rows.map(toRequest);
  }

  async close(id: string, closed: boolean): Promise<void> {
    await this.pool.query(`update portal_requests set closed_at = case when $2 then coalesce(closed_at, now()) else null end where id = $1`, [id, closed]);
  }

  // Links -------------------------------------------------------------------------------------------

  async insertLink(l: { id: string; requestId: string; tokenHash: Buffer; createdBy: string | null; expiresAt: string }, db: PoolClient | Pool = this.pool): Promise<void> {
    await db.query(
      'insert into portal_links (id, request_id, org_id, token_hash, created_by, expires_at) values ($1, $2, (select org_id from portal_requests where id = $2), $3, $4, $5)',
      [l.id, l.requestId, l.tokenHash, l.createdBy, l.expiresAt],
    );
  }

  async link(id: string): Promise<PortalLinkRow | null> {
    const { rows } = await this.pool.query('select * from portal_links where id = $1', [id]);
    return rows[0] ? toLink(rows[0]) : null;
  }

  async links(requestId: string): Promise<PortalLinkRow[]> {
    const { rows } = await this.pool.query('select * from portal_links where request_id = $1 order by created_at desc limit 20', [requestId]);
    return rows.map(toLink);
  }

  /** The link that works now: the newest one neither revoked nor expired, of a request still open. */
  async activeLink(requestId: string): Promise<PortalLinkRow | null> {
    const { rows } = await this.pool.query(
      `select l.* from portal_links l join portal_requests r on r.id = l.request_id
       where l.request_id = $1 and l.revoked_at is null and l.expires_at > now() and r.closed_at is null order by l.created_at desc limit 1`,
      [requestId],
    );
    return rows[0] ? toLink(rows[0]) : null;
  }

  /** The link an email of this conversation carries when it is sent. */
  async activeLinkForThread(threadId: string): Promise<PortalLinkRow | null> {
    const { rows } = await this.pool.query(
      `select l.* from portal_links l join portal_requests r on r.id = l.request_id
       where r.thread_id = $1 and l.revoked_at is null and l.expires_at > now() and r.closed_at is null order by l.created_at desc limit 1`,
      [threadId],
    );
    return rows[0] ? toLink(rows[0]) : null;
  }

  /** Revokes every working link of a request (all of them, or only `linkId`); returns the ids revoked. */
  async revoke(requestId: string, linkId?: string, db: PoolClient | Pool = this.pool): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `update portal_links set revoked_at = now() where request_id = $1 and revoked_at is null and ($2::uuid is null or id = $2) returning id`,
      [requestId, linkId ?? null],
    );
    return rows.map((r) => r.id);
  }

  async touchLink(id: string): Promise<void> {
    await this.pool.query('update portal_links set last_used_at = now() where id = $1', [id]);
  }

  // Events ------------------------------------------------------------------------------------------

  async event(
    e: { id: string; requestId: string | null; linkId: string | null; kind: PortalEventKind; ip?: string; userAgent?: string; detail?: Record<string, unknown> },
    db: PoolClient | Pool = this.pool,
  ): Promise<void> {
    await db.query('insert into portal_events (id, request_id, org_id, link_id, kind, ip, user_agent, detail) values ($1, $2, (select org_id from portal_requests where id = $2), $3, $4, $5, $6, $7)', [
      e.id, e.requestId, e.linkId, e.kind, e.ip?.slice(0, 64) ?? null, e.userAgent?.slice(0, 300) ?? null, e.detail ? JSON.stringify(e.detail) : null,
    ]);
  }

  /**
   * What happened on a request, newest first. Openings are grouped per hour and address (the page
   * asks again while it checks), with how many there were.
   */
  async events(requestId: string, limit = 50) {
    const { rows } = await this.pool.query(
      `select kind, detail, ip, created_at, 1 as count from portal_events where request_id = $1 and kind <> 'opened'
       union all
       select 'opened', null, ip, min(created_at), count(*)::int from portal_events where request_id = $1 and kind = 'opened'
         group by ip, date_trunc('hour', created_at)
       order by created_at desc limit $2`,
      [requestId, limit],
    );
    return rows.map((r) => ({ kind: r.kind as PortalEventKind, detail: (r.detail ?? {}) as Record<string, unknown>, ip: r.ip as string | null, count: Number(r.count), createdAt: iso(r.created_at)! }));
  }

  /** Deletes refused accesses that matched no request after `days` days (they are only for abuse checks). */
  async pruneDenied(days: number): Promise<number> {
    const { rowCount } = await this.pool.query(`delete from portal_events where request_id is null and created_at < now() - make_interval(days => $1)`, [days]);
    return rowCount ?? 0;
  }

  // Uploads -----------------------------------------------------------------------------------------

  async insertUpload(u: { id: string; requestId: string; messageId: string | null; documentIds: string[] }): Promise<void> {
    await this.pool.query(
      `insert into portal_uploads (id, request_id, org_id, message_id, document_ids, status) values ($1, $2, (select org_id from portal_requests where id = $2), $3, $4, 'extracting')`,
      [u.id, u.requestId, u.messageId, u.documentIds],
    );
  }

  async uploads(requestId: string, limit = 20): Promise<PortalUploadView[]> {
    const { rows } = await this.pool.query(
      `select u.*, coalesce((select array_agg(d.file_name order by d.created_at) from documents d where d.id = any(u.document_ids)), '{}') as files
       from portal_uploads u where u.request_id = $1 order by u.created_at desc limit $2`,
      [requestId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      files: r.files,
      ...(r.findings !== null ? { findings: r.findings } : {}),
      ...(r.error ? { error: r.error } : {}),
      createdAt: iso(r.created_at)!,
    }));
  }

  /** Every document the supplier uploaded through this request. */
  async uploadedDocuments(requestId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ id: string }>('select unnest(document_ids)::text as id from portal_uploads where request_id = $1', [requestId]);
    return new Set(rows.map((r) => r.id));
  }

  /** Takes the oldest upload whose documents are all extracted (or failed), marking it validating. */
  async claimUpload(): Promise<{ id: string; requestId: string; shipmentId: string } | null> {
    const { rows } = await this.pool.query(
      `update portal_uploads set status = 'validating', updated_at = now()
       where id = (
         select u.id from portal_uploads u join portal_requests r on r.id = u.request_id
         where u.status = 'extracting'
           and not exists (select 1 from documents d where d.shipment_id = r.shipment_id and d.status in ('QUEUED', 'EXTRACTING'))
         order by u.created_at limit 1 for update of u skip locked)
       returning id, request_id, (select shipment_id from portal_requests r where r.id = request_id) as shipment_id`,
    );
    return rows[0] ? { id: rows[0].id, requestId: rows[0].request_id, shipmentId: rows[0].shipment_id } : null;
  }

  async finishUpload(id: string, status: 'validated' | 'failed', fields: { findings?: number; error?: string }): Promise<void> {
    await this.pool.query('update portal_uploads set status = $2, findings = $3, error = $4, updated_at = now() where id = $1', [id, status, fields.findings ?? null, fields.error?.slice(0, 500) ?? null]);
  }

  /** Uploads left validating by a process that stopped: checked again. */
  async recoverUploads(): Promise<number> {
    const { rowCount } = await this.pool.query(`update portal_uploads set status = 'extracting' where status = 'validating' and updated_at < now() - interval '10 minutes'`);
    return rowCount ?? 0;
  }

  // What the supplier sees --------------------------------------------------------------------------

  async latestValidation(shipmentId: string): Promise<{ id: string; createdAt: string; skipped: { ruleId: string; missing: DocumentType[] }[] } | null> {
    const { rows } = await this.pool.query('select id, created_at, skipped from validations where shipment_id = $1 order by created_at desc limit 1', [shipmentId]);
    return rows[0] ? { id: rows[0].id, createdAt: iso(rows[0].created_at)!, skipped: rows[0].skipped ?? [] } : null;
  }

  /** The latest finding with each of these fingerprints in any validation of the shipment (for the ones fixed since). */
  async findingsByFingerprint(shipmentId: string, fingerprints: string[]) {
    if (fingerprints.length === 0) return [];
    const { rows } = await this.pool.query(
      `select distinct on (f.fingerprint) f.* from findings f join validations v on v.id = f.validation_id
       where v.shipment_id = $1 and f.fingerprint = any($2) order by f.fingerprint, v.created_at desc`,
      [shipmentId, fingerprints],
    );
    return rows;
  }

  async findingsOf(validationId: string) {
    const { rows } = await this.pool.query('select * from findings where validation_id = $1 order by id', [validationId]);
    return rows;
  }

  async documents(shipmentId: string): Promise<Map<string, PortalDocumentMeta>> {
    const { rows } = await this.pool.query(
      `select d.id, d.detected_type, coalesce(i.seller_id, pl.seller_id) as seller_id
       from documents d left join invoices i on i.document_id = d.id left join packing_lists pl on pl.document_id = d.id
       where d.shipment_id = $1`,
      [shipmentId],
    );
    return new Map(rows.map((r) => [r.id as string, { id: r.id, type: r.detected_type, ...(r.seller_id ? { sellerId: r.seller_id } : {}) }]));
  }
}
