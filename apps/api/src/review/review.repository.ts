import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FieldConfidence, SupplierExample, TextLine } from '@doccheck/extraction';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export interface QueueItem {
  documentId: string;
  shipmentId: string;
  shipmentReference: string | null;
  destination: string | null;
  fileName: string;
  documentType: string;
  /** Fields under the threshold, and how many of them nobody has checked yet. */
  lowFields: number;
  pending: number;
  minConfidence: number;
  extractedAt: string;
}

export interface FieldReview {
  path: string;
  status: 'accepted' | 'corrected';
  userId: string | null;
  createdAt: string;
}

/** Fields under the threshold with no review, per document of an organization's shipments, as SQL. */
const PENDING_SQL = `
  select f.document_id, d.shipment_id, s.reference, s.destination, d.file_name, d.detected_type, f.computed_at,
         count(*)::int as low_fields,
         count(*) filter (where r.path is null)::int as pending,
         min((e.value->>'confidence')::numeric)::float as min_confidence
  from field_confidence f
  join documents d on d.id = f.document_id and d.status = 'EXTRACTED'
  join shipments s on s.id = d.shipment_id
  cross join lateral jsonb_array_elements(f.fields) e(value)
  left join field_reviews r on r.document_id = f.document_id and r.path = e.value->>'path'
  where s.org_id = $1 and (e.value->>'confidence')::numeric < $2
  group by f.document_id, d.shipment_id, s.reference, s.destination, d.file_name, d.detected_type, f.computed_at, d.created_at`;

@Injectable()
export class ReviewRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Replaces a document's field confidence; its earlier reviews were about another extraction and go. */
  async saveConfidence(documentId: string, fields: FieldConfidence[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from field_reviews where document_id = $1', [documentId]);
      await client.query(
        `insert into field_confidence (document_id, fields, computed_at) values ($1, $2, now())
         on conflict (document_id) do update set fields = excluded.fields, computed_at = now()`,
        [documentId, JSON.stringify(fields)],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Extracted documents that have no field confidence yet (extracted before it existed). */
  async unscored(limit: number) {
    const { rows } = await this.pool.query(
      `select e.document_id, d.detected_type, d.page_count, e.raw, coalesce(e.model_data, e.data) as data, e.issues, e.pdf_lines
       from extractions e join documents d on d.id = e.document_id left join field_confidence f on f.document_id = e.document_id
       where f.document_id is null and d.status = 'EXTRACTED' and e.raw is not null limit $1`,
      [limit],
    );
    return rows.map((r) => ({ documentId: r.document_id as string, documentType: r.detected_type as string, pageCount: r.page_count as number, raw: r.raw, data: r.data, issues: r.issues as string[], pdfLines: r.pdf_lines as TextLine[] }));
  }

  /** Documents with fields still to check, the least sure first. */
  async queue(orgId: string, threshold: number, limit: number, offset: number): Promise<{ items: QueueItem[]; total: number; fields: number }> {
    const { rows } = await this.pool.query(
      `with q as (${PENDING_SQL} having count(*) filter (where r.path is null) > 0)
       select *, count(*) over ()::int as total, sum(pending) over ()::int as fields from q
       order by min_confidence, computed_at limit $3 offset $4`,
      [orgId, threshold, limit, offset],
    );
    const counts = rows[0] ? { total: rows[0].total, fields: rows[0].fields } : await this.counts(orgId, threshold);
    return {
      ...counts,
      items: rows.map((r) => ({
        documentId: r.document_id,
        shipmentId: r.shipment_id,
        shipmentReference: r.reference,
        destination: r.destination,
        fileName: r.file_name,
        documentType: r.detected_type,
        lowFields: r.low_fields,
        pending: r.pending,
        minConfidence: Math.round(r.min_confidence * 100) / 100,
        extractedAt: new Date(r.computed_at).toISOString(),
      })),
    };
  }

  /** How many documents and fields wait for a review. */
  async counts(orgId: string, threshold: number): Promise<{ total: number; fields: number }> {
    const { rows } = await this.pool.query(
      `with q as (${PENDING_SQL} having count(*) filter (where r.path is null) > 0)
       select count(*)::int as total, coalesce(sum(pending), 0)::int as fields from q`,
      [orgId, threshold],
    );
    return { total: rows[0]?.total ?? 0, fields: rows[0]?.fields ?? 0 };
  }

  /** The next document to review after `documentId` in queue order (or the first, if it is not queued). */
  async nextInQueue(orgId: string, threshold: number, documentId: string): Promise<string | null> {
    const { items } = await this.queue(orgId, threshold, 200, 0);
    const at = items.findIndex((i) => i.documentId === documentId);
    return (at < 0 ? items[0] : (items[at + 1] ?? items.find((i) => i.documentId !== documentId)))?.documentId ?? null;
  }

  /** A document of the organization with its field confidence and reviews; null if it is not the organization's. */
  async document(orgId: string, documentId: string) {
    const { rows } = await this.pool.query(
      `select d.id, d.shipment_id, d.file_name, d.detected_type, d.page_count, d.status, s.reference, s.destination, f.fields, f.computed_at, e.data
       from documents d join shipments s on s.id = d.shipment_id left join field_confidence f on f.document_id = d.id
       left join extractions e on e.document_id = d.id
       where d.id = $1 and s.org_id = $2`,
      [documentId, orgId],
    );
    const r = rows[0];
    if (!r) return null;
    const reviews = await this.pool.query('select path, status, user_id, created_at from field_reviews where document_id = $1', [documentId]);
    return {
      documentId: r.id as string,
      shipmentId: r.shipment_id as string,
      shipmentReference: r.reference as string | null,
      destination: r.destination as string | null,
      fileName: r.file_name as string,
      documentType: r.detected_type as string,
      pageCount: r.page_count as number,
      status: r.status as string,
      fields: (r.fields ?? []) as FieldConfidence[],
      /** The document as it is now (corrections included). */
      data: r.data as unknown,
      computedAt: r.computed_at ? new Date(r.computed_at).toISOString() : null,
      reviews: reviews.rows.map((x): FieldReview => ({ path: x.path, status: x.status, userId: x.user_id, createdAt: new Date(x.created_at).toISOString() })),
    };
  }

  /** Records checks; a later check of the same field replaces the earlier one. */
  async saveReviews(documentId: string, userId: string, paths: string[], status: FieldReview['status']): Promise<void> {
    if (paths.length === 0) return;
    await this.pool.query(
      `insert into field_reviews (document_id, path, status, user_id)
       select $1, p, $3, $4 from unnest($2::text[]) p
       on conflict (document_id, path) do update set status = excluded.status, user_id = excluded.user_id, created_at = now()`,
      [documentId, paths, status, userId],
    );
  }

  /** The fields of the document that have a confidence entry (corrections of others are not reviews). */
  async scoredPaths(documentId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ path: string }>("select e->>'path' as path from field_confidence, jsonb_array_elements(fields) e where document_id = $1", [documentId]);
    return new Set(rows.map((r) => r.path));
  }

  async dropReviews(documentId: string, status?: FieldReview['status']): Promise<void> {
    await this.pool.query(`delete from field_reviews where document_id = $1${status ? ' and status = $2' : ''}`, status ? [documentId, status] : [documentId]);
  }

  // Supplier learning.

  async shipmentOrg(shipmentId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ org_id: string | null }>('select org_id from shipments where id = $1', [shipmentId]);
    return rows[0]?.org_id ?? null;
  }

  async suppliers(orgId: string): Promise<{ key: string; name: string }[]> {
    const { rows } = await this.pool.query<{ key: string; name: string }>(
      'select distinct on (supplier_key) supplier_key as key, supplier_name as name from supplier_examples where org_id = $1 order by supplier_key, created_at desc',
      [orgId],
    );
    return rows;
  }

  async examples(orgId: string, supplierKey: string, documentType: string, limit: number): Promise<SupplierExample[]> {
    const { rows } = await this.pool.query(
      `select document_type, field, model_value, correct_value, line from supplier_examples
       where org_id = $1 and supplier_key = $2 and document_type = $3 order by created_at desc limit $4`,
      [orgId, supplierKey, documentType, limit],
    );
    return rows.map((r) => ({ documentType: r.document_type, field: r.field, modelValue: r.model_value, correctValue: r.correct_value, ...(r.line ? { line: r.line } : {}) }));
  }

  /** Stores examples in the organization of the document's shipment (never another one). */
  async saveExamples(userId: string, supplier: { key: string; name: string }, documentId: string, examples: SupplierExample[]): Promise<void> {
    for (const e of examples) {
      await this.pool.query(
        `insert into supplier_examples (id, org_id, user_id, supplier_key, supplier_name, document_type, field, model_value, correct_value, line, document_id)
         select $1, s.org_id, $2, $3, $4, $5, $6, $7, $8, $9, d.id
         from documents d join shipments s on s.id = d.shipment_id where d.id = $10 and s.org_id is not null
         on conflict (org_id, supplier_key, document_type, field) do update set
           supplier_name = excluded.supplier_name, user_id = excluded.user_id, model_value = excluded.model_value, correct_value = excluded.correct_value,
           line = excluded.line, document_id = excluded.document_id, created_at = now()`,
        [randomUUID(), userId, supplier.key, supplier.name, e.documentType, e.field, e.modelValue, e.correctValue, e.line ?? null, documentId],
      );
    }
  }

  async forgetDocumentExamples(documentId: string): Promise<void> {
    await this.pool.query('delete from supplier_examples where document_id = $1', [documentId]);
  }

  /** The account's learned suppliers with their examples, for the account page. */
  async listExamples(orgId: string) {
    const { rows } = await this.pool.query(
      `select supplier_key, supplier_name, document_type, field, model_value, correct_value, line, created_at from supplier_examples
       where org_id = $1 order by supplier_name, created_at desc`,
      [orgId],
    );
    return rows.map((r) => ({
      supplierKey: r.supplier_key as string,
      supplierName: r.supplier_name as string,
      documentType: r.document_type as string,
      field: r.field as string,
      modelValue: r.model_value as string | null,
      correctValue: r.correct_value as string | null,
      line: r.line as string | null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async deleteSupplier(orgId: string, supplierKey: string): Promise<number> {
    const res = await this.pool.query('delete from supplier_examples where org_id = $1 and supplier_key = $2', [orgId, supplierKey]);
    return res.rowCount ?? 0;
  }
}
