import { BadRequestException, Injectable } from '@nestjs/common';
import { type DutyContext, type DutyEstimate, type DutyInputs, type EntryDraft, entryDraft, estimateDuties, loadDutyTables } from '@doccheck/duties';
import { findFieldSource } from '@doccheck/extraction';
import type { BillOfLading, CommercialInvoice, PackingList } from '@doccheck/schemas';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import { ShipmentsService } from '../shipments/shipments.service';
import { DutiesRepository } from './duties.repository';

export interface DutiesView {
  estimate: DutyEstimate;
  /** Prefilled CBP 7501 (US) or CBSA CAD (CA), never transmitted. Absent when there is no estimate. */
  entry?: EntryDraft;
  inputsUpdatedAt?: string;
}

const SLOT = { COMMERCIAL_INVOICE: 'invoice', PACKING_LIST: 'packingList', BILL_OF_LADING: 'billOfLading' } as const;

/**
 * Duty and landed-cost estimate of a shipment, from its latest extracted documents, the answers
 * saved for it and the rate tables in data/duties. Computed on every request (the tables and the
 * documents change), nothing leaves the server.
 */
@Injectable()
export class DutiesService {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly repo: ShipmentsRepository,
    private readonly duties: DutiesRepository,
  ) {}

  async view(id: string, override?: DutyInputs): Promise<DutiesView> {
    const shipment = await this.shipments.get(id);
    if (!shipment.destination) throw new BadRequestException('Set the destination (CA or US) before estimating duties');
    const saved = await this.duties.inputs(id);
    const inputs = override ?? saved.inputs;

    const ctx: DutyContext = { shipmentId: id, destination: shipment.destination, ...(shipment.reference ? { reference: shipment.reference } : {}), ...(shipment.transportMode ? { transportMode: shipment.transportMode } : {}) };
    const pdfs = new Map<string, Parameters<typeof findFieldSource>[0]>();
    // The latest extracted document of each type, as validation uses.
    for (const e of await this.repo.listExtractions(id)) {
      const slot = SLOT[e.documentType as keyof typeof SLOT];
      if (!slot || !e.data) continue;
      pdfs.set(e.documentId, { pageCount: e.document.pageCount, lines: e.pdfLines, text: '' });
      if (slot === 'invoice') ctx.invoice = { id: e.documentId, data: e.data as CommercialInvoice };
      if (slot === 'packingList') ctx.packingList = { id: e.documentId, data: e.data as PackingList };
      if (slot === 'billOfLading') ctx.billOfLading = { id: e.documentId, data: e.data as BillOfLading };
    }

    const today = new Date().toISOString();
    const estimate = estimateDuties(ctx, inputs, loadDutyTables(), { today: today.slice(0, 10), generatedAt: today });
    // Evidence opens the PDF on the line that prints the value, like the validation findings.
    for (const f of estimate.findings) {
      for (const ev of f.evidence) {
        const pdf = pdfs.get(ev.documentId);
        if (pdf && !ev.source && ev.value) ev.source = findFieldSource(pdf, ev.documentId, ev.field, ev.value);
      }
    }
    const entry = entryDraft(ctx, estimate, inputs);
    return { estimate, ...(entry ? { entry } : {}), ...(!override && saved.updatedAt ? { inputsUpdatedAt: saved.updatedAt } : {}) };
  }

  async saveInputs(id: string, inputs: DutyInputs, userId: string): Promise<DutiesView> {
    await this.shipments.get(id);
    await this.duties.saveInputs(id, inputs, userId);
    return this.view(id);
  }
}
