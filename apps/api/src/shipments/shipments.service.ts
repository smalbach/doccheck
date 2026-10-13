import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { attachRegulations, reviewFindings, type AgentDecision } from '@doccheck/agent';
import { findSource, type LlmClient, type PdfText } from '@doccheck/extraction';
import { runRules, type EngineOutput, type ShipmentContext } from '@doccheck/rules';
import type { BillOfLading, CommercialInvoice, Isf, PackingList, Shipment, ShipmentDocument } from '@doccheck/schemas';
import { InjectLlm, RegulationsService } from '../llm/llm.module';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ExtractionQueue } from './extraction.queue';
import type { CreateShipmentDto, ValidateShipmentDto } from './shipments.dto';
import { ShipmentsRepository } from './shipments.repository';

const SLOT = {
  COMMERCIAL_INVOICE: 'invoice',
  PACKING_LIST: 'packingList',
  BILL_OF_LADING: 'billOfLading',
} as const;

export interface AgentOutcome {
  status: 'done' | 'skipped' | 'failed';
  citations: number;
  decisions: AgentDecision[];
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shipments, documents, extractions and validation runs live in Postgres; PDFs in object storage.
 * Extraction is asynchronous: uploads are queued and processed by the extraction worker.
 */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly repo: ShipmentsRepository,
    private readonly queue: ExtractionQueue,
    private readonly regulations: RegulationsService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @InjectLlm() private readonly llm: LlmClient,
  ) {}

  async create(dto: CreateShipmentDto): Promise<Shipment> {
    const shipment: Shipment = {
      id: randomUUID(),
      reference: dto.reference,
      destination: dto.destination,
      transportMode: dto.transportMode,
      status: 'RECEIVED',
      documents: [],
      createdAt: new Date().toISOString(),
    };
    await this.repo.createShipment(shipment);
    return shipment;
  }

  list() {
    return this.repo.listShipments();
  }

  async get(id: string): Promise<Shipment> {
    const shipment = UUID.test(id) ? await this.repo.findShipment(id) : null;
    if (!shipment) throw new NotFoundException(`Shipment ${id} not found`);
    return shipment;
  }

  /**
   * Stores the PDFs and queues their extraction. Returns the documents as QUEUED, or, with `wait`,
   * once every one is extracted or failed (handy for scripts and tests; uploads from a UI should poll).
   */
  async addDocuments(id: string, files: { name: string; bytes: Buffer }[], wait = false) {
    await this.get(id);
    for (const f of files) {
      if (!f.bytes.subarray(0, 5).toString('latin1').startsWith('%PDF')) throw new BadRequestException(`${f.name} is not a PDF`);
    }
    const documents: ShipmentDocument[] = [];
    for (const f of files) {
      const documentId = randomUUID();
      const doc: ShipmentDocument = {
        id: documentId,
        shipmentId: id,
        fileName: f.name,
        storageKey: `${id}/${documentId}.pdf`,
        sha256: createHash('sha256').update(f.bytes).digest('hex'),
        pageCount: 0,
        detectedType: 'UNKNOWN',
        typeConfidence: 0,
        status: 'QUEUED',
      };
      await this.storage.put(doc.storageKey, f.bytes, 'application/pdf');
      await this.repo.insertDocument(doc);
      documents.push(doc);
    }
    await this.repo.refreshShipmentStatus(id);
    await this.queue.enqueue(documents.map((d) => d.id), wait);
    if (!wait) return { queue: this.queue.mode, documents };
    return { queue: this.queue.mode, documents: await Promise.all(documents.map((d) => this.document(id, d.id))) };
  }

  /** Stores the shipment's ISF (US ocean). Replaces any previous one. */
  async saveIsf(id: string, data: Isf, source = 'upload') {
    const shipment = await this.get(id);
    if (shipment.destination !== 'US') throw new BadRequestException('The ISF only applies to US-bound shipments');
    await this.repo.saveIsf(id, data, source);
    return this.repo.findIsf(id);
  }

  async isf(id: string) {
    await this.get(id);
    const isf = await this.repo.findIsf(id);
    if (!isf) throw new NotFoundException(`Shipment ${id} has no ISF`);
    return isf;
  }

  async deleteIsf(id: string) {
    await this.get(id);
    await this.repo.deleteIsf(id);
  }

  /** Document with its status; extraction results once it is EXTRACTED. */
  async document(id: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    const row = doc.status === 'EXTRACTED' ? await this.repo.findExtraction(id, documentId) : null;
    if (!row) return { document: doc };
    const { pdfLines, document, ...extraction } = row;
    return { document, ...extraction, lineCount: pdfLines.length };
  }

  /**
   * Runs the rules and stores the run. Documents in the body (normalized JSON) win; otherwise
   * the latest extracted document of each type is used, and its evidence gets page and bbox.
   */
  async validate(id: string, docs: ValidateShipmentDto = {}, opts: { agent?: boolean } = {}): Promise<EngineOutput & { validationId: string; agent: AgentOutcome }> {
    const shipment = await this.get(id);
    if (!shipment.destination) {
      throw new BadRequestException('Set the destination (CA or US) before validating');
    }
    const pending = await this.repo.pendingDocuments(id);
    if (pending > 0) throw new ConflictException(`${pending} document(s) are still being extracted; validate when they are done`);
    await this.repo.setStatus(id, 'VALIDATING');

    const extracted = new Map<string, { documentId: string; data: unknown; pdf: PdfText }>();
    for (const e of await this.repo.listExtractions(id)) {
      const slot = SLOT[e.documentType as keyof typeof SLOT];
      if (slot && e.data) extracted.set(slot, { documentId: e.documentId, data: e.data, pdf: { pageCount: e.document.pageCount, lines: e.pdfLines, text: '' } });
    }
    const inputs: Record<string, string> = {};
    const pick = <T>(slot: keyof typeof inputs & string, fromBody: T | undefined, bodyId: string) => {
      if (fromBody) {
        inputs[slot] = 'body';
        return { id: bodyId, data: fromBody };
      }
      const e = extracted.get(slot);
      if (!e) return undefined;
      inputs[slot] = e.documentId;
      return { id: e.documentId, data: e.data as T };
    };

    const ctx: ShipmentContext = {
      shipmentId: id,
      destination: shipment.destination,
      invoice: pick<CommercialInvoice>('invoice', docs.invoice, 'invoice'),
      packingList: pick<PackingList>('packingList', docs.packingList, 'packing-list'),
      billOfLading: pick<BillOfLading>('billOfLading', docs.billOfLading, 'bill-of-lading'),
      isf: undefined,
    };
    // ISF: the one in the body wins, otherwise the one stored for the shipment.
    const storedIsf = docs.isf ? null : await this.repo.findIsf(id);
    if (docs.isf) {
      ctx.isf = { id: 'isf', data: docs.isf };
      inputs.isf = 'body';
    } else if (storedIsf) {
      ctx.isf = { id: 'isf', data: storedIsf.data };
      inputs.isf = 'stored';
    }
    const output = runRules(ctx);

    const pdfById = new Map([...extracted.values()].map((e) => [e.documentId, e.pdf]));
    for (const finding of output.findings) {
      for (const ev of finding.evidence) {
        const pdf = pdfById.get(ev.documentId);
        if (pdf && !ev.source) ev.source = findSource(pdf, ev.documentId, ev.value);
      }
    }

    const agent = await this.runAgent(ctx, output, opts.agent ?? process.env.AGENT_ENABLED !== 'false');

    const validationId = randomUUID();
    await this.repo.saveValidation({ id: validationId, shipmentId: id, ran: output.ran, skipped: output.skipped, inputs, findings: output.findings, agent });
    await this.repo.setStatus(id, output.skipped.length > 0 ? 'NEEDS_INPUT' : 'DONE');
    return { validationId, ...output, agent };
  }

  /**
   * Second pass: regulation citations, then the local model on ambiguous cases. Best effort: if the
   * model or the index is unavailable the rule findings are returned as they are, and the outcome says why.
   */
  private async runAgent(ctx: ShipmentContext, output: EngineOutput, enabled: boolean): Promise<AgentOutcome> {
    const outcome: AgentOutcome = { status: 'skipped', citations: 0, decisions: [] };
    try {
      const index = await this.regulations.get();
      if (index) {
        await attachRegulations(output.findings, ctx.destination, index);
        outcome.citations = output.findings.filter((f) => f.regulation).length;
      }
      if (!enabled) return outcome;
      const review = await reviewFindings(ctx, output.findings, this.llm, index ?? undefined);
      output.findings = review.findings;
      outcome.decisions = review.decisions;
      outcome.status = 'done';
    } catch (err) {
      outcome.status = 'failed';
      outcome.error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Agent review failed for ${ctx.shipmentId}: ${outcome.error}`);
    }
    return outcome;
  }

  /** The PDF of a document, from object storage. */
  async file(id: string, documentId: string): Promise<{ name: string; bytes: Buffer }> {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    return { name: doc.fileName, bytes: await this.storage.get(doc.storageKey) };
  }

  /** Latest validation run: rules that ran or were skipped, agent outcome and findings. */
  async latestValidation(id: string) {
    await this.get(id);
    const validation = await this.repo.latestValidation(id);
    if (!validation) throw new NotFoundException(`Shipment ${id} has not been validated yet`);
    return { ...validation, findings: await this.repo.latestFindings(id) };
  }

  async findings(id: string) {
    await this.get(id);
    return this.repo.latestFindings(id);
  }
}
