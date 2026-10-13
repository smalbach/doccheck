import { Inject, Injectable } from '@nestjs/common';
import type { TextLine } from '@doccheck/extraction';
import type { DocumentStatus, DocumentType, Finding, Isf, Shipment, ShipmentDocument, ShipmentStatus } from '@doccheck/schemas';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

export interface ExtractionRow {
  documentId: string;
  documentType: DocumentType;
  model: string;
  promptVersion: string;
  raw: unknown;
  data: unknown;
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

export interface ValidationRow {
  id: string;
  shipmentId: string;
  ran: string[];
  skipped: { ruleId: string; missing: DocumentType[] }[];
  inputs: Record<string, string>;
  findings: Finding[];
  agent?: unknown;
  createdAt?: string;
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

const toFinding = (r: Record<string, unknown>): Finding => ({
  id: r.id as string,
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

  async createShipment(s: Shipment): Promise<void> {
    await this.pool.query(
      'insert into shipments (id, reference, destination, transport_mode, status, created_at) values ($1, $2, $3, $4, $5, $6)',
      [s.id, s.reference ?? null, s.destination ?? null, s.transportMode ?? null, s.status, s.createdAt],
    );
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

  /** Most recent first, with counts for a list view. */
  async listShipments(limit = 50): Promise<(Omit<Shipment, 'documents'> & { documentCount: number; findingCount: number | null })[]> {
    const { rows } = await this.pool.query(
      `select s.*,
         (select count(*)::int from documents d where d.shipment_id = s.id) as document_count,
         (select count(*)::int from findings f where f.validation_id =
            (select v.id from validations v where v.shipment_id = s.id order by v.created_at desc limit 1)) as finding_count,
         exists (select 1 from validations v where v.shipment_id = s.id) as validated
       from shipments s order by s.created_at desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      ...(r.reference ? { reference: r.reference } : {}),
      ...(r.destination ? { destination: r.destination } : {}),
      ...(r.transport_mode ? { transportMode: r.transport_mode } : {}),
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      documentCount: r.document_count,
      findingCount: r.validated ? r.finding_count : null,
    }));
  }

  async latestValidation(shipmentId: string): Promise<(Omit<ValidationRow, 'findings'> & { createdAt: string }) | null> {
    const { rows } = await this.pool.query('select * from validations where shipment_id = $1 order by created_at desc limit 1', [shipmentId]);
    const r = rows[0];
    if (!r) return null;
    return { id: r.id, shipmentId: r.shipment_id, ran: r.ran, skipped: r.skipped, inputs: r.inputs, agent: r.agent ?? undefined, createdAt: new Date(r.created_at).toISOString() };
  }

  /** Replaces the shipment's ISF. `documentId` is the PDF it was extracted from, if any. */
  async saveIsf(shipmentId: string, data: Isf, source: string, documentId?: string): Promise<void> {
    await this.pool.query(
      `insert into isf_filings (shipment_id, data, source, document_id) values ($1, $2, $3, $4)
       on conflict (shipment_id) do update set data = excluded.data, source = excluded.source, document_id = excluded.document_id, updated_at = now()`,
      [shipmentId, JSON.stringify(data), source, documentId ?? null],
    );
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

  async deleteIsf(shipmentId: string): Promise<void> {
    await this.pool.query('delete from isf_filings where shipment_id = $1', [shipmentId]);
  }

  /** Drops the ISF taken from this document, e.g. after it was re-extracted as another type. */
  async deleteIsfFromDocument(documentId: string): Promise<void> {
    await this.pool.query('delete from isf_filings where document_id = $1', [documentId]);
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

  /** Detected type, page count and the extraction itself, in one transaction. Re-running a job replaces it. */
  async saveExtraction(
    documentId: string,
    doc: Pick<ShipmentDocument, 'pageCount' | 'detectedType' | 'typeConfidence' | 'language'>,
    extraction: ExtractionRow,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update documents set page_count = $2, detected_type = $3, type_confidence = $4, language = $5, status = 'EXTRACTED', error = null
         where id = $1`,
        [documentId, doc.pageCount, doc.detectedType, doc.typeConfidence, doc.language ?? null],
      );
      await client.query(
        `insert into extractions (document_id, model, prompt_version, raw, data, issues, pdf_lines, input_tokens, output_tokens)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (document_id) do update set model = excluded.model, prompt_version = excluded.prompt_version, raw = excluded.raw,
           data = excluded.data, issues = excluded.issues, pdf_lines = excluded.pdf_lines, input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens, created_at = now()`,
        [
          documentId, extraction.model, extraction.promptVersion, JSON.stringify(extraction.raw), JSON.stringify(extraction.data),
          JSON.stringify(extraction.issues), JSON.stringify(extraction.pdfLines), extraction.inputTokens ?? null, extraction.outputTokens ?? null,
        ],
      );
      await client.query('commit');
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

  async pendingDocuments(shipmentId: string): Promise<number> {
    const { rows } = await this.pool.query(`select count(*)::int as n from documents where shipment_id = $1 and status in ('QUEUED', 'EXTRACTING')`, [shipmentId]);
    return rows[0].n;
  }

  async findExtraction(shipmentId: string, documentId: string): Promise<(ExtractionRow & { document: ShipmentDocument }) | null> {
    const { rows } = await this.pool.query(
      `select d.*, e.model, e.prompt_version, e.raw, e.data, e.issues, e.pdf_lines, e.input_tokens, e.output_tokens
       from documents d join extractions e on e.document_id = d.id
       where d.shipment_id = $1 and d.id = $2`,
      [shipmentId, documentId],
    );
    return rows[0] ? this.toExtraction(rows[0]) : null;
  }

  /** Latest successfully extracted document of each type, oldest first so later uploads win. */
  async listExtractions(shipmentId: string): Promise<(ExtractionRow & { document: ShipmentDocument })[]> {
    const { rows } = await this.pool.query(
      `select d.*, e.model, e.prompt_version, e.raw, e.data, e.issues, e.pdf_lines, e.input_tokens, e.output_tokens
       from documents d join extractions e on e.document_id = d.id
       where d.shipment_id = $1 order by d.created_at`,
      [shipmentId],
    );
    return rows.map((r) => this.toExtraction(r));
  }

  async saveValidation(v: ValidationRow): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into validations (id, shipment_id, ran, skipped, inputs, agent) values ($1, $2, $3, $4, $5, $6)', [
        v.id, v.shipmentId, JSON.stringify(v.ran), JSON.stringify(v.skipped), JSON.stringify(v.inputs), v.agent === undefined ? null : JSON.stringify(v.agent),
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

  /** Findings of the most recent validation run. */
  async latestFindings(shipmentId: string): Promise<Finding[]> {
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
      issues: r.issues as string[],
      pdfLines: r.pdf_lines as TextLine[],
      inputTokens: (r.input_tokens as number | null) ?? undefined,
      outputTokens: (r.output_tokens as number | null) ?? undefined,
    };
  }
}
