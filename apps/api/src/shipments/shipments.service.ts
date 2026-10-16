import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { attachRegulations, reviewFindings, reviewScreeningMatches, type AgentDecision } from '@doccheck/agent';
import { findFieldSource, inputFormat, prepareImage, readSpreadsheet, storedSpreadsheetFormat, type ExtractableType, type LlmClient, type PdfText } from '@doccheck/extraction';
import { runRules, type EngineOutput, type ShipmentContext } from '@doccheck/rules';
import { SCREENING_RULES, type ScreeningQuestion } from '@doccheck/screening';
import {
  applyPointerChanges, CANCELLED_ERROR, clip, DOCUMENT_SCHEMAS, diffPointers, fieldPointer, findingPreview, FINDING_PREVIEWS_PER_RULE, readPointer, startStage, toPointer,
  type Attestation, type BillOfLading, type CommercialInvoice, type Destination, type DocumentFormat, type Isf, type PackingList, type PointerChange, type Shipment, type ShipmentDocument,
} from '@doccheck/schemas';
import { ALL_RULES, CONTEXT_SLOTS, type ContextSlot } from '@doccheck/rules';
import { isDemo } from '../demo/demo-mode';
import { InjectLlm, RegulationsService } from '../llm/llm.module';
import type { ProgressRun } from '../progress/progress-run';
import { RuleSettingsService } from '../rules/rule-settings.service';
import { ProgressRepository } from '../progress/progress.repository';
import { ProgressService } from '../progress/progress.service';
import { ScreeningService } from '../screening/screening.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../collab/notifications.service';
import { ReviewService } from '../review/review.service';
import { UsageService } from '../usage/usage.service';
import { DocumentProcessor } from './document.processor';
import { ExtractionQueue } from './extraction.queue';
import { ReviewRequestsRepository } from './review-requests.repository';
import { FindingReviewsRepository } from './reviews.repository';
import { CLOSING_STATUSES, type ReviewedFinding } from './reviews.types';
import type { CreateShipmentDto, ListShipmentsQuery, ReviewFindingsDto, UpdateShipmentDto, ValidateShipmentDto } from './shipments.dto';
import { ShipmentsRepository, type CorrectionResult, type ExtractionRow, type NewCorrection, type ShipmentScope } from './shipments.repository';

/** Citation progress events carry the passage's title cut to this length. */
const CITATION_TITLE_CHARS = 120;

/** The context slot each extracted document type fills. ISF PDFs fill none: validation reads the shipment's ISF filing. */
const SLOT = Object.fromEntries(Object.entries(CONTEXT_SLOTS).filter(([slot]) => slot !== 'isf').map(([slot, type]) => [type, slot])) as Record<string, Exclude<ContextSlot, 'isf'>>;

const slotOf = (type: string) => (Object.keys(CONTEXT_SLOTS) as ContextSlot[]).find((slot) => CONTEXT_SLOTS[slot] === type)!;

/** The schema a corrected document must still pass, per document type. */
const SCHEMA = DOCUMENT_SCHEMAS;

/** How an upload of each format is stored: its extension and content type. Photos are stored as image-only PDFs. */
const STORED: Record<DocumentFormat, (name: string) => { ext: string; contentType: string }> = {
  PDF: () => ({ ext: 'pdf', contentType: 'application/pdf' }),
  IMAGE: () => ({ ext: 'pdf', contentType: 'application/pdf' }),
  SPREADSHEET: (name) =>
    /\.xlsx$|\.xlsm$/i.test(name)
      ? { ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      : { ext: 'csv', contentType: 'text/csv' },
};

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
    private readonly progressRepo: ProgressRepository,
    private readonly processor: DocumentProcessor,
    private readonly reviews: FindingReviewsRepository,
    private readonly requests: ReviewRequestsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly ruleSettings: RuleSettingsService,
    private readonly usage: UsageService,
    private readonly review: ReviewService,
    private readonly screening: ScreeningService,
  ) {}

  /** A new shipment in the organization, created by `userId`. */
  async create(dto: CreateShipmentDto, userId: string, orgId: string): Promise<Shipment> {
    const shipment: Shipment = {
      id: randomUUID(),
      reference: dto.reference,
      destination: dto.destination,
      transportMode: dto.transportMode,
      status: 'RECEIVED',
      documents: [],
      createdAt: new Date().toISOString(),
    };
    await this.repo.createShipment(shipment, userId, orgId);
    this.audit.note({ orgId, action: 'shipment.create', entity: 'shipment', entityId: shipment.id, after: dto });
    return shipment;
  }

  list(scope: ShipmentScope, query: ListShipmentsQuery) {
    return this.repo.listShipments(scope, { ...query, q: query.q || undefined });
  }

  /** Edits the reference, destination or transport mode; earlier validations stay as history. */
  async update(id: string, dto: UpdateShipmentDto): Promise<Shipment> {
    if (!UUID.test(id)) throw new NotFoundException(`Shipment ${id} not found`);
    const reference = dto.reference === undefined ? undefined : dto.reference || null;
    const before = await this.repo.findShipment(id);
    const res = await this.repo.updateShipment(id, { ...dto, reference });
    if (res === 'not-found') throw new NotFoundException(`Shipment ${id} not found`);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; change the destination when they are done');
    if (res === 'manual-isf') throw new ConflictException('The shipment has an ISF entered by hand, which only applies to the US; delete it first');
    const after = await this.get(id);
    const fields = (x: Shipment | null) => x && { reference: x.reference ?? null, destination: x.destination ?? null, transportMode: x.transportMode ?? null };
    this.audit.note({ action: 'shipment.update', entity: 'shipment', entityId: id, before: fields(before), after: fields(after) });
    return after;
  }

  /** Deletes a shipment with everything attached to it, PDFs included. Refused while documents are extracting. */
  async remove(id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException(`Shipment ${id} not found`);
    const before = await this.repo.findShipment(id);
    const res = await this.repo.deleteShipment(id);
    if (res === 'not-found') throw new NotFoundException(`Shipment ${id} not found`);
    if (res === 'pending') throw new ConflictException('Documents are still being extracted; delete the shipment when they are done');
    if (before) {
      this.audit.note({
        action: 'shipment.delete',
        entity: 'shipment',
        entityId: id,
        before: { reference: before.reference ?? null, destination: before.destination ?? null, documents: before.documents.map((d) => d.fileName) },
      });
    }
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
    const formats = files.map((f) => inputFormat(f.name, new Uint8Array(f.bytes)));
    files.forEach((f, i) => {
      if (!formats[i]) throw new BadRequestException(`${f.name} is not a PDF, a photo (JPEG, PNG, HEIC) or a spreadsheet (.xlsx, .csv)`);
    });
    // Photos are straightened, cropped and stored as an image-only PDF (read with OCR); a spreadsheet must open.
    const prepared = await Promise.all(
      files.map(async (f, i) => {
        if (formats[i] === 'IMAGE') return prepareImage(new Uint8Array(f.bytes), f.name).then((img) => img.pdf, (err: Error) => Promise.reject(new BadRequestException(`${f.name}: ${err.message}`)));
        if (formats[i] === 'SPREADSHEET') {
          try {
            readSpreadsheet(new Uint8Array(f.bytes), f.name);
          } catch (err) {
            throw new BadRequestException(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return f.bytes;
      }),
    );
    // Each file is at least one extraction of the plan: a hard limit refuses the whole upload (402).
    await this.usage.assertAllowed(id, 'extraction', files.length);
    const documents: ShipmentDocument[] = [];
    for (const [i, f] of files.entries()) {
      const documentId = randomUUID();
      const format = formats[i]!;
      const { ext, contentType } = STORED[format](f.name);
      const doc: ShipmentDocument = {
        id: documentId,
        shipmentId: id,
        fileName: f.name,
        storageKey: `${id}/${documentId}.${ext}`,
        sha256: createHash('sha256').update(f.bytes).digest('hex'),
        pageCount: 0,
        detectedType: 'UNKNOWN',
        typeConfidence: 0,
        status: 'QUEUED',
        ...(format !== 'PDF' ? { format } : {}),
      };
      await this.storage.put(doc.storageKey, prepared[i], contentType);
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
    await this.usage.assertAllowed(id, 'extraction');
    // Not an ISF after all: the ISF taken from it goes now, even if the new extraction fails.
    if (type !== 'ISF') await this.repo.deleteIsfFromDocument(documentId);
    await this.repo.updateDocumentStatus(documentId, 'QUEUED');
    await this.repo.refreshShipmentStatus(id);
    await this.queue.enqueue(id, [documentId], wait, type);
    return this.document(id, documentId);
  }

  /**
   * Cancels a document's extraction. Waiting in line: it leaves the queue and ends FAILED ("Cancelled
   * by the user") at once, with a failed `saved` event. Running: the process running it (this one or
   * a worker) is asked to stop, and the processor ends it the same way; the document is returned as
   * it is then (still EXTRACTING if a worker elsewhere has not stopped yet). 409 when neither.
   */
  async cancelExtraction(id: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    if (doc.status !== 'QUEUED' && doc.status !== 'EXTRACTING') throw new ConflictException('The document is not being extracted');
    if (await this.repo.cancelQueuedDocument(documentId, CANCELLED_ERROR)) {
      await this.queue.remove(documentId);
      const latest = await this.progressRepo.latestExtractionRun(id, documentId);
      const run = this.progress.run('extraction', id, { documentId, runId: latest && !latest.ended ? latest.runId : undefined });
      const waited = latest?.queuedAt ? Math.max(0, Date.now() - latest.queuedAt.getTime()) : 0;
      if (latest && !latest.ended) await run.emit({ stage: 'queued', status: 'failed', durationMs: waited, detail: { error: CANCELLED_ERROR } });
      await run.emit({ stage: 'saved', status: 'failed', durationMs: 0, detail: { error: CANCELLED_ERROR, reason: 'cancelled' } });
      await this.repo.refreshShipmentStatus(id);
      this.logger.log(`${doc.fileName}: cancelled while queued`);
    } else {
      await this.processor.cancel(documentId);
    }
    await this.progress.flush();
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
    // The corrected fields leave the review queue; with supplier learning they become examples.
    await this.review.onCorrected(userId, { documentId, documentType: row.documentType, raw: row.raw, data: applied.data, pdfLines: row.pdfLines }, corrections);
    return this.document(id, documentId);
  }

  /** Puts back what the model read; the history keeps the corrections and records the revert. */
  async revertCorrections(id: string, documentId: string, userId: string) {
    const row = await this.correctable(id, documentId);
    if (!row.modelData) throw new BadRequestException('The document has no corrections to revert');
    const corrections = diffPointers(row.data, row.modelData).map((path) => ({ path, oldValue: readPointer(row.data, path), newValue: readPointer(row.modelData, path) }));
    this.check(await this.repo.saveCorrections(id, documentId, userId, { before: row.data, after: row.modelData, corrections, revert: true }), documentId);
    await this.review.onReverted(documentId);
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
    await this.usage.assertAllowed(id, 'validation');
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

    type Source = { documentId: string; data: unknown; modelData?: unknown; corrected: string[]; pdf: PdfText; ocr: boolean; attestation?: Attestation };
    const extracted = new Map<string, Source>();
    // ISF PDFs do not fill a slot here: the processor stores them as the shipment's ISF, read below.
    const isfPdfs = new Map<string, Source>();
    // Documents uploaded but not usable (not normalized): their rules are skipped for input, not "not applicable".
    const unusable = new Set<string>();
    for (const e of await this.repo.listExtractions(id)) {
      if (!e.data) unusable.add(e.documentType);
      const slot = SLOT[e.documentType as keyof typeof SLOT];
      const ocr = e.issues.some((i) => i.startsWith('Read with OCR'));
      const pdf = { pageCount: e.document.pageCount, lines: e.pdfLines, text: '' };
      const row: Source = { documentId: e.documentId, data: e.data, modelData: e.modelData, corrected: correctedPaths(e), pdf, ocr, attestation: e.attestation };
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
    // The other documents (air waybill, certificates, arrival notice...): body first, then the latest extracted.
    for (const slot of Object.values(SLOT)) {
      if (slot === 'invoice' || slot === 'packingList' || slot === 'billOfLading') continue;
      const chosen = pick(slot, docs[slot], slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
      if (chosen) Object.assign(ctx, { [slot]: chosen });
    }
    // Signature and stamp seen on the paper of the documents used (rule T13).
    const attestations = Object.fromEntries([...extracted.values()].filter((e) => e.attestation && Object.values(inputs).includes(e.documentId)).map((e) => [e.documentId, e.attestation!]));
    if (Object.keys(attestations).length) ctx.attestations = attestations;
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
    const documents = (Object.keys(CONTEXT_SLOTS) as ContextSlot[]).filter((slot) => ctx[slot]).length;
    const rules = await startStage(run.report, 'rules', { documents });
    // The account's rule settings, its history (earlier invoices, prices, purchase orders) and the run
    // date; what was applied is saved with the run.
    const { config, account, asOf, applied } = await this.ruleSettings.forValidation(ctx);
    ctx.account = account;
    ctx.asOf = asOf;
    // Each rule's findings go out with it (a few, cut short), so the web can show them as they are found.
    // Screening rules (S1-S3) run after the document rules and count in the same total.
    const extra = SCREENING_RULES.length;
    let engineTotal = 0;
    const output = runRules(ctx, {}, {
      config,
      onRule: ({ rule, index, total, skipped, findings, found }) => {
        engineTotal = total;
        void rules.progress({ rule, index, total: total + extra, skipped, findings, ...(found.length > 0 ? { found: found.slice(0, FINDING_PREVIEWS_PER_RULE).map(findingPreview) } : {}) });
      },
    });
    // Screening (S1-S3) after the document rules, numbered after the last rule the engine reported.
    const screened = await this.screening.screen(ctx);
    for (const [i, def] of SCREENING_RULES.entries()) {
      const found = screened.findings.filter((f) => f.ruleId === def.id);
      output.ran.push(def.id);
      output.findings.push(...found);
      await rules.progress({ rule: def.id, index: engineTotal + i + 1, total: engineTotal + extra, skipped: false, findings: found.length, ...(found.length > 0 ? { found: found.slice(0, FINDING_PREVIEWS_PER_RULE).map(findingPreview) } : {}) });
    }
    const notApplicable = output.notApplicable?.length ?? 0;
    // An optional rule whose document is there but could not be read is missing input, so the user sees it.
    for (const ruleId of [...(output.notApplicable ?? [])]) {
      const def = ALL_RULES.find((r) => r.definition.id === ruleId)?.definition;
      const missing = def ? [...def.requires, ...(def.requiresAny ?? [])].filter((t) => unusable.has(t) && !(ctx[slotOf(t)] ?? false)) : [];
      if (!missing.length) continue;
      output.notApplicable = output.notApplicable!.filter((r) => r !== ruleId);
      output.skipped.push({ ruleId, missing });
    }
    await rules.done({ ran: output.ran.length, skipped: output.skipped.length, total: output.ran.length + output.skipped.length + notApplicable, findings: output.findings.length });

    const sources = [...extracted.values(), ...(isfPdf ? [isfPdf] : [])];
    const sourceById = new Map(sources.map((e) => [e.documentId, e]));
    const ocrDocs = new Set(sources.filter((e) => e.ocr).map((e) => e.documentId));
    for (const finding of output.findings) {
      for (const ev of finding.evidence) {
        const src = sourceById.get(ev.documentId);
        if (!src) continue;
        // A value corrected by hand is not what the PDF prints: say so, and cite where the model's value is.
        if (citesCorrected(ev.field, src.corrected)) ev.corrected = true;
        if (!ev.source && ev.value) ev.source = findFieldSource(src.pdf, ev.documentId, ev.field, ev.value);
        const printed = ev.corrected ? readPointer(src.modelData, fieldPointer(ev.field)) : undefined;
        if (!ev.source && (typeof printed === 'string' || typeof printed === 'number')) ev.source = findFieldSource(src.pdf, ev.documentId, ev.field, String(printed));
      }
      // OCR confuses look-alike characters (7/T, 0/O, 1/I): say so before anyone acts on the finding.
      if (finding.evidence.some((ev) => ocrDocs.has(ev.documentId))) {
        const note = 'Some of these values were read from a scan with OCR; confirm them against the document first.';
        finding.suggestedFix = finding.suggestedFix ? `${note} ${finding.suggestedFix}` : note;
      }
    }

    const agent = await this.runAgent(ctx, output, useAgent, run, screened.questions);

    const saved = await startStage(run.report, 'saved');
    await this.repo.saveValidation({ id: validationId, shipmentId: id, ran: output.ran, skipped: output.skipped, inputs, findings: output.findings, agent, destination, ruleConfig: { ...applied, disabled: output.disabled } });
    await this.repo.setStatus(id, output.skipped.length > 0 ? 'NEEDS_INPUT' : 'DONE');
    await this.usage.record(id, 'validation');
    await saved.done({ validationId, findings: output.findings.length, skipped: output.skipped.length, agent: agent.status });
    return { validationId, ...output, agent };
  }

  /**
   * Second pass: regulation citations, then the local model on ambiguous cases. Best effort: if the
   * model or the index is unavailable the rule findings are returned as they are, and the outcome says why.
   */
  private async runAgent(ctx: ShipmentContext, output: EngineOutput, enabled: boolean, run: ProgressRun<'validation'>, screening: ScreeningQuestion[] = []): Promise<AgentOutcome> {
    const outcome: AgentOutcome = { status: 'skipped', citations: 0, decisions: [] };
    const citations = await startStage(run.report, 'citations', { findings: output.findings.length });
    let citing = true;
    try {
      const index = await this.regulations.get();
      if (index) {
        await attachRegulations(output.findings, ctx.destination, index, (f) => citations.progress({ findingId: f.id, title: clip(f.regulation.title, CITATION_TITLE_CHARS) }));
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
      // Borderline screening matches (S2) only: the model compares, never clears one.
      if (screening.length > 0) {
        const compared = await reviewScreeningMatches(output.findings, screening, this.llm);
        output.findings = compared.findings;
        outcome.decisions.push(...compared.decisions);
      }
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

  /** The stored file of a document, from object storage, with its content type. */
  async file(id: string, documentId: string): Promise<{ name: string; bytes: Buffer; contentType: string }> {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    return { name: doc.fileName, bytes: await this.storage.get(doc.storageKey), contentType: STORED[doc.format ?? 'PDF'](doc.storageKey).contentType };
  }

  /** The cells of a spreadsheet document, read from its stored file, and the sheets (1-based) it covers. */
  async sheets(id: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.findDocument(documentId) : null;
    if (!doc || doc.shipmentId !== id) throw new NotFoundException(`Document ${documentId} not found in shipment ${id}`);
    if (doc.format !== 'SPREADSHEET') throw new BadRequestException('The document is not a spreadsheet');
    const bytes = new Uint8Array(await this.storage.get(doc.storageKey));
    const sheets = readSpreadsheet(bytes, doc.fileName, storedSpreadsheetFormat(bytes));
    return { sheets, pages: doc.pages ?? sheets.map((_, i) => i + 1) };
  }

  /**
   * Latest validation run: rules that ran or were skipped, agent outcome and findings, each with the
   * user's decisions about it and whether it is new since the previous run; `resolved` lists the
   * previous run's findings that are gone.
   */
  async latestValidation(id: string) {
    await this.get(id);
    const validation = await this.repo.latestValidation(id);
    if (!validation) throw new NotFoundException(`Shipment ${id} has not been validated yet`);
    const [findings, history, previous] = await Promise.all([
      this.repo.latestFindings(id),
      this.reviews.history(id),
      this.reviews.previousValidation(id, validation.id),
    ]);
    const before = previous ? await this.repo.validationFindings(previous.id) : [];
    const current = new Set(findings.map((f) => f.fingerprint));
    const earlier = new Set(before.map((f) => f.fingerprint));
    const reviewed: ReviewedFinding[] = findings.map((f) => {
      const list = history.get(f.fingerprint) ?? [];
      return { ...f, ...(list[0] ? { review: list[0] } : {}), history: list, isNew: previous !== null && !earlier.has(f.fingerprint) };
    });
    return {
      ...validation,
      findings: reviewed,
      ...(previous ? { previous, resolved: before.filter((f) => !current.has(f.fingerprint)) } : {}),
    };
  }

  /**
   * Records a decision about findings of the latest run. In an organization that requires approval,
   * an accepted risk or false positive becomes a request reviewers are told about, and counts once approved.
   */
  async reviewFindings(id: string, userId: string, dto: ReviewFindingsDto) {
    await this.get(id);
    const findings = await this.repo.latestFindings(id);
    const byFingerprint = new Map(findings.map((f) => [f.fingerprint, f]));
    const unknown = dto.fingerprints.filter((fp) => !byFingerprint.has(fp));
    if (unknown.length) throw new BadRequestException(`Not findings of the latest validation: ${unknown.join(', ')}`);
    const picked = [...new Set(dto.fingerprints)].map((fp) => ({ fingerprint: fp, ruleId: byFingerprint.get(fp)!.ruleId }));
    const policy = await this.repo.approvalPolicy(id);
    const fingerprints = picked.map((p) => p.fingerprint);
    if (policy?.requireApproval && CLOSING_STATUSES.includes(dto.status)) {
      // Two-step: the decision waits for a reviewer who is not the one asking (POST :id/approvals/:requestId).
      await this.requests.create(id, userId, picked, dto.status as 'accepted' | 'false_positive', dto.note ?? '');
      this.audit.note({ action: 'finding.request', entity: 'shipment', entityId: id, after: { fingerprints, status: dto.status, note: dto.note } });
      await this.notifications.notify({
        userIds: policy.approvers,
        kind: 'approval_requested',
        orgId: policy.orgId,
        shipmentId: id,
        actorId: userId,
        detail: { count: picked.length, status: dto.status, excerpt: dto.note },
      });
      return this.latestValidation(id);
    }
    const before = Object.fromEntries((await this.repo.findingStatuses(id, fingerprints)).map((r) => [r.fingerprint, r.status]));
    await this.requests.withdraw(id, fingerprints, userId);
    await this.reviews.save(id, userId, picked, dto.status, dto.note || undefined);
    this.audit.note({ action: 'finding.review', entity: 'shipment', entityId: id, before, after: { fingerprints, status: dto.status, note: dto.note } });
    return this.latestValidation(id);
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
