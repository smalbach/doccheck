import { runRules, type ShipmentContext } from '@doccheck/rules';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * A known account history for the Data Q&A evaluation (and analytics tests): shipments of the
 * synthetic evaluation set (data/eval/v1/<id>/truth.json) with their documents extracted as the
 * ground truth, the rules run on them, and their validations spread over the last months, so that
 * "this month" in a question means the same thing to the model and to the expected query. Every
 * third shipment with findings gets a second validation half a day later with its first finding
 * corrected. Rows go in with plain SQL; the projection triggers fill the extracted-data tables.
 */

const SLOTS = { invoice: 'COMMERCIAL_INVOICE', packingList: 'PACKING_LIST', billOfLading: 'BILL_OF_LADING' } as const;
const DAY = 86_400_000;

export interface FixtureShipment {
  id: string;
  reference: string;
  findings: number;
}

export async function buildFixture(pool: Pool, userId: string, evalDir: string, ids: readonly string[], now = new Date()): Promise<FixtureShipment[]> {
  const out: FixtureShipment[] = [];
  for (const [n, ref] of ids.entries()) {
    const truth = JSON.parse(await readFile(join(evalDir, ref, 'truth.json'), 'utf8'));
    const shipmentId = randomUUID();
    // Newest first: shipment n is validated about 5n days ago (and spread across the hours).
    const validatedAt = new Date(now.getTime() - (n * 5 + 1) * DAY - (n % 7) * 3_600_000);
    const createdAt = new Date(validatedAt.getTime() - DAY);
    await pool.query(`insert into shipments (id, reference, destination, transport_mode, status, user_id, created_at) values ($1, $2, $3, 'SEA', 'DONE', $4, $5)`, [
      shipmentId, ref, truth.destination, userId, createdAt,
    ]);
    const ctx: ShipmentContext = { shipmentId, destination: truth.destination };
    for (const [slot, type] of Object.entries(SLOTS) as [keyof typeof SLOTS, string][]) {
      const data = truth.documents[slot];
      if (!data) continue;
      const documentId = randomUUID();
      await pool.query(
        `insert into documents (id, shipment_id, file_name, storage_key, sha256, page_count, detected_type, type_confidence, status, created_at)
         values ($1, $2, $3, 'none', '0', 1, $4, 1, 'EXTRACTED', $5)`,
        [documentId, shipmentId, `${slot}.pdf`, type, createdAt],
      );
      await pool.query(`insert into extractions (document_id, model, prompt_version, raw, data, pdf_lines) values ($1, 'fixture', 'fixture', '{}', $2, '[]')`, [documentId, JSON.stringify(data)]);
      ctx[slot] = { id: documentId, data };
    }
    if (truth.documents.isf && truth.destination === 'US') {
      await pool.query(`insert into isf_filings (shipment_id, data, source) values ($1, $2, 'upload')`, [shipmentId, JSON.stringify(truth.documents.isf)]);
      ctx.isf = { id: 'isf', data: truth.documents.isf };
    }
    const result = runRules(ctx);
    await saveRun(pool, shipmentId, truth.destination, result.ran, result.findings, validatedAt);
    if (result.findings.length > 0 && n % 3 === 0) {
      await saveRun(pool, shipmentId, truth.destination, result.ran, result.findings.slice(1), new Date(validatedAt.getTime() + DAY / 2));
    }
    out.push({ id: shipmentId, reference: ref, findings: result.findings.length });
  }
  return out;
}

async function saveRun(pool: Pool, shipmentId: string, destination: string, ran: string[], findings: ReturnType<typeof runRules>['findings'], at: Date) {
  const validationId = randomUUID();
  await pool.query(`insert into validations (id, shipment_id, ran, skipped, inputs, destination, created_at) values ($1, $2, $3, '[]', '{}', $4, $5)`, [
    validationId, shipmentId, JSON.stringify(ran), destination, at,
  ]);
  for (const f of findings) {
    await pool.query(
      `insert into findings (id, validation_id, shipment_id, rule_id, severity, decided_by, message, evidence) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [f.id, validationId, shipmentId, f.ruleId, f.severity, f.decidedBy, f.message, JSON.stringify(f.evidence)],
    );
  }
}
