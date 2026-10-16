import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TextLine } from '@doccheck/extraction';
import type { Destination, DocumentStatus, DocumentType, Finding, Isf, Severity, Shipment, ShipmentDocument, ShipmentStatus, TransportMode } from '@doccheck/schemas';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { FingerprintedFinding } from './reviews.types';

export interface ExtractionRow {
  documentId: string;
  documentType: DocumentType;
  model: string;
  promptVersion: string;
  raw: unknown;
  data: unknown;
  /** What the model read, when values were corrected by hand since (data is then the corrected document). */
  modelData?: unknown;
  issues: string[];
  pdfLines: TextLine[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface IsfRow {
  data: Isf;
  /** 'upload' (JSON), 'sample' or 'pdf'. */
  source: string;
  updatedAt: string;
  /** The PDF the ISF was extracted from, when source is 'pdf'. */
  documentId?: string;
  fileName?: string;
}

export interface CorrectionRow {
  id: string;
  /** JSON pointer into the document. */
  path: string;
  oldValue: unknown;
  newValue: unknown;
  action: 'edit' | 'revert';
  userName?: string;
  createdAt: string;
}

export interface NewCorrection {
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

export type CorrectionResult = 'ok' | 'not-found' | 'pending' | 'changed' | 'nothing';

export interface ValidationRow {
  id: string;
  shipmentId: string;
  ran: string[];
  skipped: { ruleId: string; missing: DocumentType[] }[];
  inputs: Record<string, string>;
  findings: Finding[];
  agent?: unknown;
  destination?: Destination;
  /** The rule settings, tolerances, run date and account history the run applied (null before they were recorded). */
  ruleConfig?: unknown;
  createdAt?: string;
}

export interface ValidationSummary {
  id: string;
  createdAt: string;
  destination?: Destination;
  ran: number;
  skipped: number;
  agentStatus?: string;
  findings: number;
  bySeverity: Partial<Record<Severity, number>>;
}

export type StatusGroup = 'all' | 'open' | 'attention' | 'done';

export interface ShipmentListQuery {
  status: StatusGroup;
  destination?: Destination;
  q?: string;
  /** overdue: past its due date and not done; soon: due in the next 48 hours. */
  due?: 'overdue' | 'soon';
  /** Assigned to this user (the shipment, or one of its findings). */
  assignee?: string;
  limit: number;
  offset: number;
}

/**
 * Whose shipments a list covers: the organization's, or for a client only those shared with them
 * (`sharedWith`).
 */
export interface ShipmentScope {
  orgId: string;
  sharedWith?: string;
}

export type ShipmentSummary = Omit<Shipment, 'documents'> & {
  documentCount: number;
  findingCount: number | null;
  dueAt?: string;
  dueSource?: 'manual' | 'isf' | 'eta';
  overdue?: boolean;
  assignee?: { id: string; name: string };
};

export interface ShipmentPage {
  items: ShipmentSummary[];
  total: number;
  limit: number;
  offset: number;
  /** Over all of the user's shipments, whatever the filters. */
  /** findings: open ones (not accepted nor marked false positive); waiting: asked of the supplier. */
  summary: { all: number; open: number; attention: number; done: number; findings: number; waiting: number; overdue: number; dueSoon: number };
}

export interface ShipmentPatch {
  reference?: string | null;
  destination?: Destination;
  transportMode?: TransportMode;
}

/** SQL conditions on a row of `listed` (status, finding_count, validated) for each status group. */
const STATUS_GROUP: Record<Exclude<StatusGroup, 'all'>, string> = {
  open: `status in ('RECEIVED', 'EXTRACTING', 'VALIDATING')`,
  attention: `(status = 'NEEDS_INPUT' or (validated and finding_count > 0))`,
  done: `(status = 'DONE' and validated and finding_count = 0)`,
};

/** The organization's shipments ($1), only those shared with $2 when it is set (a client). */
const SCOPE = `s.org_id = $1 and ($2::uuid is null or exists (select 1 from shipment_shares x where x.shipment_id = s.id and x.user_id = $2))`;

/** On a row with due_effective and the columns of STATUS_GROUP: past due and not done, or due within 48 hours. */
const DUE_FLAGS = `coalesce(due_effective < now() and not ${STATUS_GROUP.done}, false) as overdue,
  coalesce(due_effective >= now() and due_effective < now() + interval '48 hours' and not ${STATUS_GROUP.done}, false) as due_soon`;

const toValidation = (r: Record<string, unknown>): Omit<ValidationRow, 'findings'> & { createdAt: string } => ({
  id: r.id as string,
  shipmentId: r.shipment_id as string,
  ran: r.ran as string[],
  skipped: r.skipped as ValidationRow['skipped'],
  inputs: r.inputs as Record<string, string>,
  agent: r.agent ?? undefined,
  ...(r.destination ? { destination: r.destination as Destination } : {}),
  ...(r.rule_config ? { ruleConfig: r.rule_config } : {}),
  createdAt: new Date(r.created_at as string).toISOString(),
});

export const ISF_CHANGED =
  "Not used as the shipment's ISF: it changed while this PDF was being extracted (a filing entered by hand, or an ISF PDF uploaded later). Re-extract this PDF as ISF to use it.";

/** The stored ISF came from a PDF uploaded before document $3, so a newer upload may replace it. */
const OLDER_PDF = `isf_filings.source = 'pdf' and isf_filings.document_id is distinct from $3
  and (select created_at from documents where id = isf_filings.document_id) < (select created_at from documents where id = $3)`;

/**
 * Removes the ISF taken from this document and, if it was the shipment's ISF, falls back to the
 * newest other ISF PDF of the shipment that extracted fine, so an older upload is not lost.
 */
async function dropIsfFromDocument(client: Pool | PoolClient, documentId: string): Promise<void> {
  const gone = await client.query<{ shipment_id: string }>('delete from isf_filings where document_id = $1 returning shipment_id', [documentId]);
  if (!gone.rowCount) return;
  await client.query(
    `insert into isf_filings (shipment_id, data, source, document_id)
     select d.shipment_id, e.data, 'pdf', d.id
     from documents d join extractions e on e.document_id = d.id join shipments s on s.id = d.shipment_id
     where d.shipment_id = $1 and d.id <> $2 and d.detected_type = 'ISF' and d.status = 'EXTRACTED' and e.data is not null and s.destination = 'US'
     order by d.created_at desc limit 1
     on conflict (shipment_id) do nothing`,
    [gone.rows[0].shipment_id, documentId],
  );
}

const toDocument = (r: Record<string, unknown>): ShipmentDocument => ({
  id: r.id as string,
  shipmentId: r.shipment_id as string,
  fileName: r.file_name as string,
  storageKey: r.storage_key as string,
  sha256: r.sha256 as string,
  pageCount: r.page_count as number,
  detectedType: r.detected_type as DocumentType,
  typeConfidence: r.type_confidence as number,
  ...(r.language ? { language: r.language as string } : {}),
  status: r.status as DocumentStatus,
  ...(r.error ? { error: r.error as string } : {}),
});

/** A value for a jsonb parameter; an absent value is SQL null. */
const toJsonb = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value));

const toFinding = (r: Record<string, unknown>): FingerprintedFinding => ({
  id: r.id as string,
  fingerprint: r.fingerprint as string,
  shipmentId: r.shipment_id as string,
  ruleId: r.rule_id as string,
  severity: r.severity as Finding['severity'],
  decidedBy: r.decided_by as Finding['decidedBy'],
  message: r.message as string,
  evidence: r.evidence as Finding['evidence'],
  ...(r.regulation ? { regulation: r.regulation as Finding['regulation'] } : {}),
  ...(r.suggested_fix ? { suggestedFix: r.suggested_fix as string } : {}),
  ...(r.agent_rationale ? { agentRationale: r.agent_rationale as string } : {}),
});

/** All SQL for shipments lives here; the service works with domain types only. */
@Injectable()
export class ShipmentsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createShipment(s: Shipment, userId: string, orgId: string): Promise<void> {
    await this.pool.query(
      'insert into shipments (id, reference, destination, transport_mode, status, created_at, user_id, org_id) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [s.id, s.reference ?? null, s.destination ?? null, s.transportMode ?? null, s.status, s.createdAt, userId, orgId],
    );
  }

  /** Whether accepted risks and false positives need approval in the shipment's organization, and who may approve. */
  async approvalPolicy(shipmentId: string): Promise<{ orgId: string; requireApproval: boolean; approvers: string[] } | null> {
    const { rows } = await this.pool.query(
      `select o.id, o.require_approval,
         array(select m.user_id from org_members m where m.org_id = o.id and m.role in ('owner', 'admin', 'reviewer')) as approvers
       from shipments s join organizations o on o.id = s.org_id where s.id = $1`,
      [shipmentId],
    );
    return rows[0] ? { orgId: rows[0].id, requireApproval: rows[0].require_approval, approvers: rows[0].approvers } : null;
  }

  /** The current status of these findings, for the audit log's "before". */
  async findingStatuses(shipmentId: string, fingerprints: string[]): Promise<{ fingerprint: string; status: string }[]> {
    const { rows } = await this.pool.query('select fingerprint, status from finding_status where shipment_id = $1 and fingerprint = any($2)', [shipmentId, fingerprints]);
    return rows;
  }

  async findShipment(id: string): Promise<Shipment | null> {
    const { rows } = await this.pool.query('select * from shipments where id = $1', [id]);
    if (!rows[0]) return null;
    const r = rows[0];
    const docs = await this.pool.query('select * from documents where shipment_id = $1 order by created_at', [id]);
    return {
      id: r.id,
      ...(r.reference ? { reference: r.reference } : {}),
      ...(r.destination ? { destination: r.destination } : {}),
      ...(r.transport_mode ? { transportMode: r.transport_mode } : {}),
      status: r.status,
      documents: docs.rows.map(toDocument),
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  /**
   * One page of the user's shipments, most recent first, with counts for a list view; `total` is the
   * number matching the filters and `summary` counts all of the user's shipments per group.
   */
  async listShipments(scope: ShipmentScope, q: ShipmentListQuery): Promise<ShipmentPage> {
    const params: unknown[] = [scope.orgId, scope.sharedWith ?? null];
    const where: string[] = [];
    if (q.due === 'overdue') where.push(`overdue`);
    if (q.due === 'soon') where.push(`due_soon`);
    if (q.assignee) {
      params.push(q.assignee);
      where.push(`(assignee_id = $${params.length} or exists (select 1 from finding_assignments a where a.shipment_id = listed.id and a.assignee_id = $${params.length}))`);
    }
    if (q.destination) {
      params.push(q.destination);
      where.push(`destination = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(coalesce(reference, '') ilike $${params.length} or id::text ilike $${params.length})`);
    }
    if (q.status !== 'all') where.push(STATUS_GROUP[q.status]);
    params.push(q.limit, q.offset);
    const { rows } = await this.pool.query(
      `with listed as (
         select s.*,
           (select count(*)::int from documents d where d.shipment_id = s.id) as document_count,
           (select count(*)::int from findings f where f.validation_id =
              (select v.id from validations v where v.shipment_id = s.id order by v.created_at desc limit 1)
              and not dc_finding_closed(f.shipment_id, f.fingerprint)) as finding_count,
           exists (select 1 from validations v where v.shipment_id = s.id) as validated,
           d.due_at as due_effective, d.due_source, u.name as assignee_name
         from shipments s left join shipment_due d on d.shipment_id = s.id left join users u on u.id = s.assignee_id
         where ${SCOPE}
       ), flagged as (
         select listed.*, ${DUE_FLAGS} from listed
       ), matching as (select * from flagged listed${where.length ? ` where ${where.join(' and ')}` : ''})
       select matching.*, count(*) over ()::int as total from matching
       order by created_at desc, id limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    const { rows: [summary] } = await this.pool.query(
      `with listed as (
         select s.status,
           (select count(*)::int from findings f where f.validation_id =
              (select v.id from validations v where v.shipment_id = s.id order by v.created_at desc limit 1)
              and not dc_finding_closed(f.shipment_id, f.fingerprint)) as finding_count,
           (select count(*)::int from findings f join finding_status st on st.shipment_id = f.shipment_id and st.fingerprint = f.fingerprint
            where f.validation_id = (select v.id from validations v where v.shipment_id = s.id order by v.created_at desc limit 1)
              and st.status = 'waiting_supplier') as waiting_count,
           exists (select 1 from validations v where v.shipment_id = s.id) as validated,
           d.due_at as due_effective
         from shipments s left join shipment_due d on d.shipment_id = s.id
         where ${SCOPE}
       ), flagged as (select listed.*, ${DUE_FLAGS} from listed)
       select count(*)::int as all,
         (count(*) filter (where ${STATUS_GROUP.open}))::int as open,
         (count(*) filter (where ${STATUS_GROUP.attention}))::int as attention,
         (count(*) filter (where ${STATUS_GROUP.done}))::int as done,
         coalesce(sum(finding_count) filter (where validated), 0)::int as findings,
         coalesce(sum(waiting_count) filter (where validated), 0)::int as waiting,
         (count(*) filter (where overdue))::int as overdue,
         (count(*) filter (where due_soon))::int as "dueSoon"
       from flagged listed`,
      [scope.orgId, scope.sharedWith ?? null],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.destination ? { destination: r.destination } : {}),
        ...(r.transport_mode ? { transportMode: r.transport_mode } : {}),
        status: r.status,
        createdAt: new Date(r.created_at).toISOString(),
        documentCount: r.document_count,
        findingCount: r.validated ? r.finding_count : null,
        ...(r.due_effective ? { dueAt: new Date(r.due_effective).toISOString(), dueSource: r.due_source, overdue: r.overdue } : {}),
        ...(r.assignee_id ? { assignee: { id: r.assignee_id, name: r.assignee_name ?? '' } } : {}),
      })),
      total: rows[0]?.total ?? (q.offset > 0 ? await this.countMatching(scope, q) : 0),
      limit: q.limit,
      offset: q.offset,
      summary,
    };
  }

  /** `total` for a page past the end, where the windowed count has no row to ride on. */
  private async countMatching(scope: ShipmentScope, q: ShipmentListQuery): Promise<number> {
    const page = await this.listShipments(scope, { ...q, offset: 0, limit: 1 });
    return page.total;
  }

  /**
   * Changes the reference, destination or transport mode. The destination is refused while documents
   * extract (the processor reads it to keep an ISF) and when leaving the US would drop an ISF entered
   * by hand; an ISF taken from a PDF is dropped then, and restored from the PDFs on coming back.
   */
  async updateShipment(id: string, patch: ShipmentPatch): Promise<'not-found' | 'pending' | 'manual-isf' | 'ok'> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const found = await client.query<{ destination: string | null }>('select destination from shipments where id = $1 for update', [id]);
      if (!found.rowCount) {
        await client.query('rollback');
        return 'not-found';
      }
      const before = found.rows[0].destination;
      const moves = patch.destination !== undefined && patch.destination !== before;
      if (moves) {
        const pending = await client.query(`select 1 from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING') limit 1`, [id]);
        if (pending.rowCount) {
          await client.query('rollback');
          return 'pending';
        }
        if (before === 'US') {
          const isf = await client.query<{ source: string }>('select source from isf_filings where shipment_id = $1', [id]);
          if (isf.rows[0] && isf.rows[0].source !== 'pdf') {
            await client.query('rollback');
            return 'manual-isf';
          }
          await client.query('delete from isf_filings where shipment_id = $1', [id]);
        }
      }
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.reference !== undefined) set('reference', patch.reference);
      if (patch.destination !== undefined) set('destination', patch.destination);
      if (patch.transportMode !== undefined) set('transport_mode', patch.transportMode);
      if (sets.length) await client.query(`update shipments set ${sets.join(', ')} where id = $1`, params);
      if (moves && patch.destination === 'US') {
        await client.query(
          `insert into isf_filings (shipment_id, data, source, document_id)
           select d.shipment_id, e.data, 'pdf', d.id
           from documents d join extractions e on e.document_id = d.id
           where d.shipment_id = $1 and d.detected_type = 'ISF' and d.status = 'EXTRACTED' and e.data is not null
           order by d.created_at desc limit 1
           on conflict (shipment_id) do nothing`,
          [id],
        );
      }
      await client.query('commit');
      return 'ok';
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async latestValidation(shipmentId: string): Promise<(Omit<ValidationRow, 'findings'> & { createdAt: string }) | null> {
    const { rows } = await this.pool.query('select * from validations where shipment_id = $1 order by created_at desc limit 1', [shipmentId]);
    return rows[0] ? toValidation(rows[0]) : null;
  }

  async findValidation(shipmentId: string, validationId: string): Promise<(Omit<ValidationRow, 'findings'> & { createdAt: string }) | null> {
    const { rows } = await this.pool.query('select * from validations where shipment_id = $1 and id = $2', [shipmentId, validationId]);
    return rows[0] ? toValidation(rows[0]) : null;
  }

  /** Every validation run of the shipment, newest first, with its findings counted by severity. */
  async listValidations(shipmentId: string): Promise<ValidationSummary[]> {
    const { rows } = await this.pool.query(
      `select v.id, v.created_at, v.destination, jsonb_array_length(v.ran) as ran, jsonb_array_length(v.skipped) as skipped, v.agent->>'status' as agent,
         coalesce((select jsonb_object_agg(severity, n) from (select severity, count(*)::int as n from findings f where f.validation_id = v.id group by severity) c), '{}') as by_severity
       from validations v where v.shipment_id = $1 order by v.created_at desc`,
      [shipmentId],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      ...(r.destination ? { destination: r.destination } : {}),
      ran: r.ran,
      skipped: r.skipped,
      ...(r.agent ? { agentStatus: r.agent } : {}),
      findings: Object.values(r.by_severity as Record<string, number>).reduce((a, b) => a + b, 0),
      bySeverity: r.by_severity,
    }));
  }

  /** Replaces the shipment's ISF. `documentId` is the PDF it was extracted from, if any. */
  async saveIsf(shipmentId: string, data: Isf, source: string, documentId?: string): Promise<void> {
    await this.pool.query(
      `insert into isf_filings (shipment_id, data, source, document_id) values ($1, $2, $3, $4)
       on conflict (shipment_id) do update set data = excluded.data, source = excluded.source, document_id = excluded.document_id, updated_at = now()`,
      [shipmentId, JSON.stringify(data), source, documentId ?? null],
    );
  }

  /** Version of the shipment's ISF (its exact updated_at), or null when it has none. */
  async isfVersion(shipmentId: string): Promise<string | null> {
    const { rows } = await this.pool.query('select updated_at::text as v from isf_filings where shipment_id = $1', [shipmentId]);
    return rows[0]?.v ?? null;
  }

  async findIsf(shipmentId: string): Promise<IsfRow | null> {
    const { rows } = await this.pool.query(
      'select i.*, d.file_name from isf_filings i left join documents d on d.id = i.document_id where i.shipment_id = $1',
      [shipmentId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      data: r.data,
      source: r.source,
      updatedAt: new Date(r.updated_at).toISOString(),
      ...(r.document_id ? { documentId: r.document_id, fileName: r.file_name } : {}),
    };
  }

  /**
   * Deletes the shipment and, by cascade, its documents, extractions, ISF, validations and findings,
   * unless a document is still extracting. Returns the storage keys to remove.
   *
   * The shipment row is locked first: an upload inserting a document waits for it (foreign key) and
   * then fails, and one that committed first is seen here as pending.
   */
  async deleteShipment(id: string): Promise<{ keys: string[] } | 'not-found' | 'pending'> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const found = await client.query('select 1 from shipments where id = $1 for update', [id]);
      if (!found.rowCount) {
        await client.query('rollback');
        return 'not-found';
      }
      const docs = await client.query<{ storage_key: string; status: string }>('select storage_key, status from documents where shipment_id = $1', [id]);
      if (docs.rows.some((r) => r.status === 'QUEUED' || r.status === 'EXTRACTING')) {
        await client.query('rollback');
        return 'pending';
      }
      await client.query('delete from shipments where id = $1', [id]);
      await client.query('commit');
      return { keys: docs.rows.map((r) => r.storage_key) };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteIsf(shipmentId: string): Promise<void> {
    await this.pool.query('delete from isf_filings where shipment_id = $1', [shipmentId]);
  }

  /** Drops the ISF taken from this document, e.g. after it was re-extracted as another type; the newest other ISF PDF takes its place. */
  async deleteIsfFromDocument(documentId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await dropIsfFromDocument(client, documentId);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async setStatus(id: string, status: ShipmentStatus): Promise<void> {
    await this.pool.query('update shipments set status = $2 where id = $1', [id, status]);
  }

  async insertDocument(doc: ShipmentDocument): Promise<void> {
    await this.pool.query(
      `insert into documents (id, shipment_id, file_name, storage_key, sha256, status)
       values ($1, $2, $3, $4, $5, $6)`,
      [doc.id, doc.shipmentId, doc.fileName, doc.storageKey, doc.sha256, doc.status ?? 'QUEUED'],
    );
  }

  async findDocument(id: string): Promise<ShipmentDocument | null> {
    const { rows } = await this.pool.query('select * from documents where id = $1', [id]);
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async updateDocumentStatus(id: string, status: DocumentStatus, error?: string): Promise<void> {
    await this.pool.query('update documents set status = $2, error = $3 where id = $1', [id, status, error ?? null]);
  }

  /**
   * Detected type, page count, the extraction itself and the shipment ISF it yields, in one transaction.
   * Re-running a job replaces the extraction.
   *
   * `isf` is the ISF read from this PDF, with `since` the version of the shipment's ISF when the job
   * started (`isfVersion`). It is stored if that ISF has not changed meanwhile, or if it now comes from
   * a PDF uploaded before this one (the newest upload wins, whatever order extractions finish in). A
   * JSON filing saved or deleted during a slow extraction is kept; the issues then say why.
   * Without `isf`, any ISF taken earlier from this document is removed.
   */
  async saveExtraction(
    documentId: string,
    doc: Pick<ShipmentDocument, 'pageCount' | 'detectedType' | 'typeConfidence' | 'language'>,
    extraction: ExtractionRow,
    isf?: { shipmentId: string; data: Isf; since: string | null },
  ): Promise<{ isfSaved: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      let isfSaved = false;
      if (!isf) await dropIsfFromDocument(client, documentId);
      else {
        const args = [isf.shipmentId, JSON.stringify(isf.data), documentId];
        // With an ISF at the start, only update: if it was deleted meanwhile it stays deleted.
        const res =
          isf.since === null
            ? await client.query(
                `insert into isf_filings (shipment_id, data, source, document_id) values ($1, $2, 'pdf', $3)
                 on conflict (shipment_id) do update set data = excluded.data, source = 'pdf', document_id = excluded.document_id, updated_at = now() where ${OLDER_PDF}`,
                args,
              )
            : await client.query(
                `update isf_filings set data = $2, source = 'pdf', document_id = $3, updated_at = now()
                 where shipment_id = $1 and (updated_at = $4::timestamptz or ${OLDER_PDF})`,
                [...args, isf.since],
              );
        isfSaved = res.rowCount === 1;
        if (!isfSaved) extraction = { ...extraction, issues: [...extraction.issues, ISF_CHANGED] };
      }
      await client.query(
        `update documents set page_count = $2, detected_type = $3, type_confidence = $4, language = $5, status = 'EXTRACTED', error = null
         where id = $1`,
        [documentId, doc.pageCount, doc.detectedType, doc.typeConfidence, doc.language ?? null],
      );
      // A new extraction replaces the document: corrections made to the previous one no longer apply.
      await client.query('delete from corrections where document_id = $1', [documentId]);
      await client.query(
        `insert into extractions (document_id, model, prompt_version, raw, data, issues, pdf_lines, input_tokens, output_tokens)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (document_id) do update set model = excluded.model, prompt_version = excluded.prompt_version, raw = excluded.raw,
           data = excluded.data, issues = excluded.issues, pdf_lines = excluded.pdf_lines, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, model_data = null, created_at = now()`,
        [
          documentId, extraction.model, extraction.promptVersion, JSON.stringify(extraction.raw), JSON.stringify(extraction.data),
          JSON.stringify(extraction.issues), JSON.stringify(extraction.pdfLines), extraction.inputTokens ?? null, extraction.outputTokens ?? null,
        ],
      );
      await client.query('commit');
      return { isfSaved };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** EXTRACTING while any document is queued or running; back to RECEIVED when none is. */
  async refreshShipmentStatus(shipmentId: string): Promise<void> {
    await this.pool.query(
      `update shipments set status = case
         when exists (select 1 from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING')) then 'EXTRACTING'
         when status = 'EXTRACTING' then 'RECEIVED'
         else status end
       where id = $1`,
      [shipmentId],
    );
  }

  /**
   * Marks documents left QUEUED or EXTRACTING by a previous process as FAILED, so they can be
   * re-extracted or deleted. Returns them, with the error they got.
   */
  async failInterruptedDocuments(): Promise<{ id: string; shipmentId: string; error: string }[]> {
    const error = 'Interrupted by a restart; extract it again';
    const { rows } = await this.pool.query<{ id: string; shipment_id: string }>(
      `update documents set status = 'FAILED', error = $1 where status in ('QUEUED', 'EXTRACTING') returning id, shipment_id`,
      [error],
    );
    for (const id of new Set(rows.map((r) => r.shipment_id))) await this.refreshShipmentStatus(id);
    return rows.map((r) => ({ id: r.id, shipmentId: r.shipment_id, error }));
  }

  /**
   * Takes a document for extraction: EXTRACTING, unless it is not waiting any more (cancelled, or
   * extracted meanwhile). EXTRACTING is accepted too: a BullMQ job whose worker died runs again.
   */
  async claimDocument(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`update documents set status = 'EXTRACTING', error = null where id = $1 and status in ('QUEUED', 'EXTRACTING')`, [id]);
    return rowCount === 1;
  }

  /** Cancels a document still waiting in line: FAILED with `error`. False when it is not QUEUED (any more). */
  async cancelQueuedDocument(id: string, error: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`update documents set status = 'FAILED', error = $2 where id = $1 and status = 'QUEUED'`, [id, error]);
    return rowCount === 1;
  }

  async pendingDocuments(shipmentId: string): Promise<number> {
    const { rows } = await this.pool.query(`select count(*)::int as n from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING')`, [shipmentId]);
    return rows[0].n;
  }

  async findExtraction(shipmentId: string, documentId: string): Promise<(ExtractionRow & { document: ShipmentDocument }) | null> {
    const { rows } = await this.pool.query(
      `select d.*, e.model, e.prompt_version, e.raw, e.data, e.model_data, e.issues, e.pdf_lines, e.input_tokens, e.output_tokens
       from documents d join extractions e on e.document_id = d.id
       where d.shipment_id = $1 and d.id = $2`,
      [shipmentId, documentId],
    );
    return rows[0] ? this.toExtraction(rows[0]) : null;
  }

  /** Latest successfully extracted document of each type, oldest first so later uploads win. */
  async listExtractions(shipmentId: string): Promise<(ExtractionRow & { document: ShipmentDocument })[]> {
    const { rows } = await this.pool.query(
      `select d.*, e.model, e.prompt_version, e.raw, e.data, e.model_data, e.issues, e.pdf_lines, e.input_tokens, e.output_tokens
       from documents d join extractions e on e.document_id = d.id
       where d.shipment_id = $1 order by d.created_at`,
      [shipmentId],
    );
    return rows.map((r) => this.toExtraction(r));
  }

  /**
   * Replaces the document's data with `after` and records the corrections, in one transaction, if the
   * document is still extracted and its data is still `before` (else 'pending' or 'changed'). The
   * model's original is kept in model_data on the first correction (`revert` brings it back, and
   * records each reverted value). The ISF taken from this document follows, and the shipment goes
   * back to RECEIVED: its last validation used other data.
   */
  async saveCorrections(
    shipmentId: string,
    documentId: string,
    userId: string,
    change: { before: unknown; after: unknown; corrections: NewCorrection[]; revert?: boolean },
  ): Promise<CorrectionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const found = await client.query<{ status: string; data: unknown; model_data: unknown }>(
        `select d.status, e.data, e.model_data from documents d join extractions e on e.document_id = d.id
         where d.id = $1 and d.shipment_id = $2 for update of d, e`,
        [documentId, shipmentId],
      );
      const row = found.rows[0];
      const refuse = async (result: CorrectionResult) => {
        await client.query('rollback');
        return result;
      };
      if (!row) return await refuse('not-found');
      if (row.status !== 'EXTRACTED') return await refuse('pending');
      const same = await client.query('select $1::jsonb = $2::jsonb as same', [JSON.stringify(row.data), JSON.stringify(change.before)]);
      if (!same.rows[0].same) return await refuse('changed');
      if (change.revert && row.model_data === null) return await refuse('nothing');

      await client.query(
        change.revert
          ? 'update extractions set data = model_data, model_data = null where document_id = $1'
          : 'update extractions set model_data = coalesce(model_data, data), data = $2 where document_id = $1',
        change.revert ? [documentId] : [documentId, JSON.stringify(change.after)],
      );
      for (const c of change.corrections) {
        await client.query(
          'insert into corrections (id, document_id, user_id, path, old_value, new_value, action) values ($1, $2, $3, $4, $5, $6, $7)',
          [randomUUID(), documentId, userId, c.path, toJsonb(c.oldValue), toJsonb(c.newValue), change.revert ? 'revert' : 'edit'],
        );
      }
      await client.query('update isf_filings set data = $2, updated_at = now() where document_id = $1', [documentId, JSON.stringify(change.after)]);
      await client.query(
        `update shipments set status = case
           when exists (select 1 from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING')) then 'EXTRACTING'
           else 'RECEIVED' end
         where id = $1`,
        [shipmentId],
      );
      await client.query('commit');
      return 'ok';
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Corrections of a document, oldest first, with who made them. */
  async listCorrections(documentId: string): Promise<CorrectionRow[]> {
    const { rows } = await this.pool.query(
      `select c.*, u.name as user_name from corrections c left join users u on u.id = c.user_id
       where c.document_id = $1 order by c.created_at, c.path`,
      [documentId],
    );
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      oldValue: r.old_value ?? null,
      newValue: r.new_value ?? null,
      action: r.action,
      ...(r.user_name ? { userName: r.user_name } : {}),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async saveValidation(v: ValidationRow): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into validations (id, shipment_id, ran, skipped, inputs, agent, destination, rule_config) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
        v.id, v.shipmentId, JSON.stringify(v.ran), JSON.stringify(v.skipped), JSON.stringify(v.inputs), v.agent === undefined ? null : JSON.stringify(v.agent), v.destination ?? null,
        v.ruleConfig === undefined ? null : JSON.stringify(v.ruleConfig),
      ]);
      for (const f of v.findings) {
        await client.query(
          `insert into findings (id, validation_id, shipment_id, rule_id, severity, decided_by, message, evidence, regulation, suggested_fix, agent_rationale)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            f.id, v.id, v.shipmentId, f.ruleId, f.severity, f.decidedBy, f.message, JSON.stringify(f.evidence),
            f.regulation ? JSON.stringify(f.regulation) : null, f.suggestedFix ?? null, f.agentRationale ?? null,
          ],
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

  async validationFindings(validationId: string): Promise<FingerprintedFinding[]> {
    const { rows } = await this.pool.query('select * from findings where validation_id = $1 order by id', [validationId]);
    return rows.map(toFinding);
  }

  /** Findings of the most recent validation run. */
  async latestFindings(shipmentId: string): Promise<FingerprintedFinding[]> {
    const { rows } = await this.pool.query(
      `select f.* from findings f
       where f.validation_id = (select id from validations where shipment_id = $1 order by created_at desc limit 1)
       order by f.id`,
      [shipmentId],
    );
    return rows.map(toFinding);
  }

  private toExtraction(r: Record<string, unknown>): ExtractionRow & { document: ShipmentDocument } {
    return {
      document: toDocument(r),
      documentId: r.id as string,
      documentType: r.detected_type as DocumentType,
      model: r.model as string,
      promptVersion: r.prompt_version as string,
      raw: r.raw,
      data: r.data,
      ...(r.model_data ? { modelData: r.model_data } : {}),
      issues: r.issues as string[],
      pdfLines: r.pdf_lines as TextLine[],
      inputTokens: (r.input_tokens as number | null) ?? undefined,
      outputTokens: (r.output_tokens as number | null) ?? undefined,
    };
  }
}
