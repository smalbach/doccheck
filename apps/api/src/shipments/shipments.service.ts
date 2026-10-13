import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { attachRegulations, reviewFindings, type AgentDecision } from '@doccheck/agent';
import { findFieldSource, type ExtractableType, type LlmClient, type PdfText } from '@doccheck/extraction';
import { runRules, type EngineOutput, type ShipmentContext } from '@doccheck/rules';
import {
  applyPointerChanges, BillOfLading, CommercialInvoice, diffPointers, fieldPointer, Isf, PackingList, readPointer, startStage, toPointer,
  type Destination, type PointerChange, type Shipment, type ShipmentDocument,
} from '@doccheck/schemas';
import { isDemo } from '../demo/demo-mode';
import { InjectLlm, RegulationsService } from '../llm/llm.module';
import type { ProgressRun } from '../progress/progress-run';
import { ProgressService } from '../progress/progress.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ExtractionQueue } from './extraction.queue';
import type { CreateShipmentDto, ListShipmentsQuery, UpdateShipmentDto, ValidateShipmentDto } from './shipments.dto';
import { ShipmentsRepository, type CorrectionResult, type ExtractionRow, type NewCorrection } from './shipments.repository';

const SLOT = {
  COMMERCIAL_INVOICE: 'invoice',
  PACKING_LIST: 'packingList',
  BILL_OF_LADING: 'billOfLading',
} as const;

/** The schema a corrected document must still pass, per document type. */
const SCHEMA = {
  COMMERCIAL_INVOICE: CommercialInvoice,
  PACKING_LIST: PackingList,
  BILL_OF_LADING: BillOfLading,
  ISF: Isf,
} as const;

/** Pointers to the values corrected by hand: where the current data differs from the model's. */
const correctedPaths = (e: Pick<ExtractionRow, 'data' | 'modelData'>): string[] => (e.modelData ? diffPointers(e.modelData, e.data) : []);

/** Whether evidence citing `field` shows a value corrected by hand (the field itself or a value inside it). */
const citesCorrected = (field: string, corrected: readonly string[]) => {
  const pointer = fieldPointer(field);
  return corrected.some((p) => p === pointer || p.startsWith(`${pointer}/`));
};

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
    private readonly progress: ProgressService,
  ) {}

  async create(dto: CreateShipmentDto, userId: string): Promise<Shipment> {
    const shipment: Shipment = {
      id: randomUUID(),
      reference: dto.reference,
      destination: dto.destination,
      transportMode: dto.transportMode,
      status: 'RECEIVED',
      documents: [],
      createdAt: new Date().toISOString(),
    };
    await this.repo.createShipment(shipment, userId);
    return shipment;
  }

  list(userId: string, query: ListShipmentsQuery) {
    return this.repo.listShipments(userId, { ...query, q: query.q || undefined });
  }

  /** Edits the reference, destination or transport mode; earlier validations stay as history. */
  async update(id: string, dto: UpdateShipmentDto): Promise<Shipment> {
    if (!UUID.test(id)) throw new NotFoundException(`Shipment ${id} not found`);
    const reference = dto.reference === undefined ? undefined : dto.reference || null;
    const res = await this.repo.updateShipment(id, { ...dto, reference });
    if (res === 'not-found') throw new NotFoundException(`Shipment ${id} not found`);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; change the destination when they are done');
    if (res === 'manual-isf') throw new ConflictException('The shipment has an ISF entered by hand, which only applies to the US; delete it first');
    return this.get(id);
  }

  /** Deletes a shipment with everything attached to it, PDFs included. Refused while documents are extracting. */
  async remove(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException(`Shipment ${id} not found`);
    const res = await this.repo.deleteShipment(id);
    if (res === 'not-found') throw new NotFoundException(`Shipment ${id} not found`);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; delete the shipment when they are done');
    // Database first: a document row pointing at a deleted file is worse than a leftover file, but a
    // leftover holds customs data, so say which ones are left.
    const failed = (await Promise.all(res.keys.map((k) => this.storage.delete(k).then(() => null, (err: Error) => `${k} (${err.message})`)))).filter(Boolean);
    if (failed.length) this.logger.warn(`Shipment ${id} deleted, but these PDFs could not be removed from storage: ${failed.join(', ')}`);
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
      try {
        await this.repo.insertDocument(doc);
      } catch (err) {
        // E.g. the shipment was deleted during the upload: do not leave the PDF behind.
        await this.storage.delete(doc.storageKey).catch(() => undefined);
        if ((err as { code?: string }).code === '23503') throw new NotFoundException(`Shipment ${id} not found`);
        throw err;
      }
      documents.push(doc);
    }
    await this.repo.refreshShipmentStatus(id);
    await this.queue.enqueue(id, documents.map((d) => d.id), wait);
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

  /** Extracts a document again as the given type, when classification got it wrong. */
  async reextract(id: string, documentId: string, type: ExtractableType, wait = false) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    if (doc.status === 'QUEUED' || doc.status === 'EXTRACTING') throw new ConflictException('The document is already being extracted');
    // Not an ISF after all: the ISF taken from it goes now, even if the new extraction fails.
    if (type !== 'ISF') await this.repo.deleteIsfFromDocument(documentId);
    await this.repo.updateDocumentStatus(documentId, 'QUEUED');
    await this.repo.refreshShipmentStatus(id);
    await this.queue.enqueue(id, [documentId], wait, type);
    return this.document(id, documentId);
  }

  /** Document with its status; extraction results once it is EXTRACTED. */
  async document(id: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    const row = doc.status === 'EXTRACTED' ? await this.repo.findExtraction(id, documentId) : null;
    if (!row) return { document: doc };
    const { pdfLines, document, modelData, ...extraction } = row;
    // The values corrected by hand, with what the model had read.
    const corrected = correctedPaths(row).map((path) => ({ path, modelValue: readPointer(modelData, path) ?? null }));
    return { document, ...extraction, corrected, lineCount: pdfLines.length };
  }

  /**
   * Corrects values of an extracted document by hand. The whole corrected document must still pass its
   * schema (400 with the issues otherwise, nothing saved). Each changed value is recorded, and the
   * shipment goes back to RECEIVED so the user validates again. Refused while the document extracts.
   */
  async correct(id: string, documentId: string, userId: string, changes: PointerChange[]) {
    const row = await this.correctable(id, documentId);
    // The last change to a path wins.
    const unique = [...new Map(changes.map((c) => [c.path, c])).values()];
    const applied = applyPointerChanges(row.data, unique);
    if (applied.issues.length) throw new BadRequestException({ message: 'Invalid corrections', issues: applied.issues });
    const parsed = SCHEMA[row.documentType as keyof typeof SCHEMA].safeParse(applied.data);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: toPointer(i.path.map(String)), message: i.message }));
      throw new BadRequestException({ message: 'The corrected document is not valid', issues });
    }
    // The schema drops fields it does not know, so a change to one is refused. The document is saved as
    // applied (not as parsed) so nothing else the model stored is dropped and shown as corrected.
    const unknown = unique.filter((c) => c.value !== null && readPointer(parsed.data, c.path) === undefined);
    if (unknown.length) throw new BadRequestException({ message: 'Invalid corrections', issues: unknown.map((c) => ({ path: c.path, message: 'Not a field of this document' })) });

    const corrections: NewCorrection[] = unique
      .map((c) => ({ path: c.path, oldValue: readPointer(row.data, c.path), newValue: readPointer(applied.data, c.path) }))
      .filter((c) => c.oldValue !== c.newValue);
    if (corrections.length === 0) return this.document(id, documentId);
    this.check(await this.repo.saveCorrections(id, documentId, userId, { before: row.data, after: applied.data, corrections }), documentId);
    return this.document(id, documentId);
  }

  /** Puts back what the model read; the history keeps the corrections and records the revert. */
  async revertCorrections(id: string, documentId: string, userId: string) {
    const row = await this.correctable(id, documentId);
    if (!row.modelData) throw new BadRequestException('The document has no corrections to revert');
    const corrections = diffPointers(row.data, row.modelData).map((path) => ({ path, oldValue: readPointer(row.data, path), newValue: readPointer(row.modelData, path) }));
    this.check(await this.repo.saveCorrections(id, documentId, userId, { before: row.data, after: row.modelData, corrections, revert: true }), documentId);
    return this.document(id, documentId);
  }

  /** History of the corrections of a document, oldest first. */
  async corrections(id: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    return this.repo.listCorrections(documentId);
  }

  /** The extraction of a document that can be corrected: extracted, with normalized data of a known type. */
  private async correctable(id: string, documentId: string): Promise<ExtractionRow> {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    if (doc.status === 'QUEUED' || doc.status === 'EXTRACTING') throw new ConflictException('The document is being extracted; correct it when it is done');
    const row = doc.status === 'EXTRACTED' ? await this.repo.findExtraction(id, documentId) : null;
    if (!row?.data || !(row.documentType in SCHEMA)) throw new BadRequestException('The document has no extracted data to correct');
    return row;
  }

  private check(result: CorrectionResult, documentId: string): void {
    if (result === 'not-found') throw new NotFoundException(`Document ${documentId} not found`);
    if (result === 'pending') throw new ConflictException('The document is being extracted; correct it when it is done');
    if (result === 'changed') throw new ConflictException('The document changed meanwhile; reload it and try again');
    if (result === 'nothing') throw new BadRequestException('The document has no corrections to revert');
  }

  /**
   * Runs the rules and stores the run. Documents in the body (normalized JSON) win; otherwise
   * the latest extracted document of each type is used, and its evidence gets page and bbox.
   * Each stage is reported as a progress event of a run whose id is the validation's id, so a client
   * listening on GET /shipments/:id/events sees it live; this call still answers when it is all done.
   */
  async validate(id: string, docs: ValidateShipmentDto = {}, opts: { agent?: boolean } = {}): Promise<EngineOutput & { validationId: string; agent: AgentOutcome }> {
    const shipment = await this.get(id);
    if (!shipment.destination) {
      throw new BadRequestException('Set the destination (CA or US) before validating');
    }
    const pending = await this.repo.pendingDocuments(id);
    if (pending > 0) throw new ConflictException(`${pending} document(s) are still being extracted; validate when they are done`);
    await this.repo.setStatus(id, 'VALIDATING');

    const validationId = randomUUID();
    const useAgent = opts.agent ?? process.env.AGENT_ENABLED !== 'false';
    const run = this.progress.run('validation', id, { runId: validationId });
    await run.emit({ stage: 'started', status: 'started', detail: { agent: useAgent, destination: shipment.destination } });
    try {
      return await this.runValidation(id, shipment.destination, docs, useAgent, run);
    } catch (err) {
      await run.fail(err, 'saved');
      throw err;
    }
  }

  private async runValidation(id: string, destination: Destination, docs: ValidateShipmentDto, useAgent: boolean, run: ProgressRun<'validation'>) {
    const validationId = run.runId;

    type Source = { documentId: string; data: unknown; modelData?: unknown; corrected: string[]; pdf: PdfText; ocr: boolean };
    const extracted = new Map<string, Source>();
    // ISF PDFs do not fill a slot here: the processor stores them as the shipment's ISF, read below.
    const isfPdfs = new Map<string, Source>();
    for (const e of await this.repo.listExtractions(id)) {
      const slot = SLOT[e.documentType as keyof typeof SLOT];
      const ocr = e.issues.some((i) => i.startsWith('Read with OCR'));
      const pdf = { pageCount: e.document.pageCount, lines: e.pdfLines, text: '' };
      const row: Source = { documentId: e.documentId, data: e.data, modelData: e.modelData, corrected: correctedPaths(e), pdf, ocr };
      if (slot && e.data) extracted.set(slot, row);
      else if (e.documentType === 'ISF') isfPdfs.set(e.documentId, row);
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
      destination,
      invoice: pick<CommercialInvoice>('invoice', docs.invoice, 'invoice'),
      packingList: pick<PackingList>('packingList', docs.packingList, 'packing-list'),
      billOfLading: pick<BillOfLading>('billOfLading', docs.billOfLading, 'bill-of-lading'),
      isf: undefined,
    };
    // ISF: the one in the body wins, otherwise the one stored for the shipment (JSON or extracted
    // from a PDF; a PDF one is cited by its document id so its evidence gets page and bbox).
    const storedIsf = docs.isf ? null : await this.repo.findIsf(id);
    const isfPdf = storedIsf?.documentId ? isfPdfs.get(storedIsf.documentId) : undefined;
    if (docs.isf) {
      ctx.isf = { id: 'isf', data: docs.isf };
      inputs.isf = 'body';
    } else if (storedIsf) {
      ctx.isf = { id: isfPdf?.documentId ?? 'isf', data: storedIsf.data };
      inputs.isf = isfPdf?.documentId ?? 'stored';
    }
    const rules = await startStage(run.report, 'rules');
    const output = runRules(ctx, {}, { onRule: ({ rule, index, total, skipped, findings }) => void rules.progress({ rule, index, total, skipped, findings }) });
    await rules.done({ ran: output.ran.length, skipped: output.skipped.length, total: output.ran.length + output.skipped.length, findings: output.findings.length });

    const sources = [...extracted.values(), ...(isfPdf ? [isfPdf] : [])];
    const sourceById = new Map(sources.map((e) => [e.documentId, e]));
    const ocrDocs = new Set(sources.filter((e) => e.ocr).map((e) => e.documentId));
    for (const finding of output.findings) {
      for (const ev of finding.evidence) {
        const src = sourceById.get(ev.documentId);
        if (!src) continue;
        // A value corrected by hand is not what the PDF prints: say so, and cite where the model's value is.
        if (citesCorrected(ev.field, src.corrected)) ev.corrected = true;
        if (!ev.source) ev.source = findFieldSource(src.pdf, ev.documentId, ev.field, ev.value);
        const printed = ev.corrected ? readPointer(src.modelData, fieldPointer(ev.field)) : undefined;
        if (!ev.source && (typeof printed === 'string' || typeof printed === 'number')) ev.source = findFieldSource(src.pdf, ev.documentId, ev.field, String(printed));
      }
      // OCR confuses look-alike characters (7/T, 0/O, 1/I): say so before anyone acts on the finding.
      if (finding.evidence.some((ev) => ocrDocs.has(ev.documentId))) {
        const note = 'Some of these values were read from a scan with OCR; confirm them against the document first.';
        finding.suggestedFix = finding.suggestedFix ? `${note} ${finding.suggestedFix}` : note;
      }
    }

    const agent = await this.runAgent(ctx, output, useAgent, run);

    const saved = await startStage(run.report, 'saved');
    await this.repo.saveValidation({ id: validationId, shipmentId: id, ran: output.ran, skipped: output.skipped, inputs, findings: output.findings, agent, destination });
    await this.repo.setStatus(id, output.skipped.length > 0 ? 'NEEDS_INPUT' : 'DONE');
    await saved.done({ validationId, findings: output.findings.length, skipped: output.skipped.length, agent: agent.status });
    return { validationId, ...output, agent };
  }

  /**
   * Second pass: regulation citations, then the local model on ambiguous cases. Best effort: if the
   * model or the index is unavailable the rule findings are returned as they are, and the outcome says why.
   */
  private async runAgent(ctx: ShipmentContext, output: EngineOutput, enabled: boolean, run: ProgressRun<'validation'>): Promise<AgentOutcome> {
    const outcome: AgentOutcome = { status: 'skipped', citations: 0, decisions: [] };
    const citations = await startStage(run.report, 'citations');
    let citing = true;
    try {
      const index = await this.regulations.get();
      if (index) {
        await attachRegulations(output.findings, ctx.destination, index);
        outcome.citations = output.findings.filter((f) => f.regulation).length;
        await citations.done({ citations: outcome.citations });
      } else {
        await citations.skip({ reason: 'no-index' });
      }
      citing = false;
      if (!enabled) {
        await run.emit({ stage: 'agent', status: 'skipped', detail: { reason: 'disabled' } });
        return outcome;
      }
      // The agent stage reports itself (started, one progress event per question asked and answered, done or failed).
      const review = await reviewFindings(ctx, output.findings, this.llm, index ?? undefined, run.report);
      output.findings = review.findings;
      outcome.decisions = review.decisions;
      outcome.status = 'done';
    } catch (err) {
      outcome.status = 'failed';
      outcome.error = err instanceof Error ? err.message : String(err);
      if (isDemo() && /Cache miss/.test(outcome.error)) outcome.error = 'The agent has no cached answer for this shipment in the read-only demo; the rule findings stand as they are.';
      this.logger.warn(`Agent review failed for ${ctx.shipmentId}: ${outcome.error}`);
      // A failure while citing: the agent never started. (The agent stage reports its own failure.)
      if (citing) {
        await citations.fail(err);
        await run.emit({ stage: 'agent', status: 'skipped', detail: { reason: enabled ? 'citations-failed' : 'disabled' } });
      }
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

  /** Every validation run, newest first, with finding counts. */
  async validations(id: string) {
    await this.get(id);
    return this.repo.listValidations(id);
  }

  /** One past run, with its findings. */
  async validation(id: string, validationId: string) {
    const validation = UUID.test(validationId) ? await this.repo.findValidation(id, validationId) : null;
    if (!validation) throw new NotFoundException(`Validation ${validationId} not found in shipment ${id}`);
    return { ...validation, findings: await this.repo.validationFindings(validationId) };
  }

  async findings(id: string) {
    await this.get(id);
    return this.repo.latestFindings(id);
  }
}
