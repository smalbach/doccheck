import { Inject, Injectable, Logger } from '@nestjs/common';
import { detectAttestation, documentParts, extractPart, PROMPT_VERSION, readStoredDocument, type ExtractableType, type ExtractionResult, type LlmClient, type StoredDocument } from '@doccheck/extraction';
import { CANCELLED_ERROR, errorText, startStage, type Attestation, type CommercialInvoice, type DocumentType, type Isf, type ShipmentDocument } from '@doccheck/schemas';
import { randomUUID } from 'node:crypto';
import { InjectLlm } from '../llm/llm.module';
import { ProgressRepository } from '../progress/progress.repository';
import { ProgressService } from '../progress/progress.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import type { ProgressRun } from '../progress/progress-run';
import { ShipmentsRepository } from './shipments.repository';

/** Documents whose paper is checked for a signature and a stamp (rule T13). */
const ATTESTED: DocumentType[] = ['BILL_OF_LADING', 'CERTIFICATE_OF_ORIGIN', 'CUSMA_CERTIFICATION'];

/** "pages 3-4" / "page 2" / a sheet's name: how a part of an upload is named after it. */
function partName(fileName: string, pages: number[], stored: StoredDocument): string {
  if (stored.sheets) return `${fileName} (${pages.map((p) => stored.sheets![p - 1]?.name ?? p).join(', ')})`;
  const sorted = [...pages].sort((a, b) => a - b);
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
  const label = sorted.length === 1 ? `page ${sorted[0]}` : contiguous ? `pages ${sorted[0]}-${sorted[sorted.length - 1]}` : `pages ${sorted.join(', ')}`;
  return `${fileName} (${label})`;
}

export interface ProcessOptions {
  /** The queue will run the job again if this attempt fails. */
  willRetry?: boolean;
  /** Progress run of this extraction (set when it was queued; kept across retries). A new one otherwise. */
  runId?: string;
  /** When the document was queued (ms), for the duration of the `queued` stage. */
  queuedAt?: number;
}

/** Thrown by `process` when the user cancelled the extraction: the queue must not run it again. */
export class ExtractionCancelledError extends Error {
  constructor() {
    super(CANCELLED_ERROR);
  }
}

/** An extraction running in this process, to stop it on a cancel request. */
interface Running {
  controller: AbortController;
  finished: Promise<void>;
}

/**
 * Extracts one stored document: PDF from storage -> local model -> extraction row in Postgres.
 * An ISF PDF is also saved as the shipment's ISF (source 'pdf'), which X11 reads.
 */
@Injectable()
export class DocumentProcessor {
  private readonly logger = new Logger(DocumentProcessor.name);
  private readonly running = new Map<string, Running>();

  constructor(
    private readonly repo: ShipmentsRepository,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @InjectLlm() private readonly llm: LlmClient,
    private readonly progress: ProgressService,
    private readonly progressRepo: ProgressRepository,
  ) {
    // Cancel requests reach every process (the worker may be another one); the one running the document stops it.
    this.progress.cancelRequests.subscribe((documentId) => this.running.get(documentId)?.controller.abort(new ExtractionCancelledError()));
  }

  /**
   * Stops the extraction of a document wherever it runs: here at once, in other processes through
   * NOTIFY. Resolves once it stopped if it ran here (at most `waitMs`), right away otherwise.
   */
  async cancel(documentId: string, waitMs = 5000): Promise<void> {
    const here = this.running.get(documentId);
    here?.controller.abort(new ExtractionCancelledError());
    await this.progress.requestCancel(documentId);
    if (here) await Promise.race([here.finished, new Promise((r) => setTimeout(r, waitMs).unref())]);
  }

  /**
   * `type` skips classification, for a document whose type the user corrected. `willRetry` says the
   * queue will run this job again if it fails: the document then stays QUEUED, so a re-extraction is
   * refused until the retry is done instead of being overwritten by it. Every stage is reported as a
   * progress event (docs/PROGRESS-EVENTS.md).
   */
  async process(documentId: string, type?: ExtractableType, options: ProcessOptions = {}): Promise<void> {
    const doc = await this.repo.findDocument(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    // Registered before the document is claimed: a cancel that finds it no longer QUEUED reaches this run.
    const controller = new AbortController();
    let finish = () => {};
    const entry: Running = { controller, finished: new Promise<void>((r) => (finish = r)) };
    this.running.set(documentId, entry);
    try {
      if (!(await this.repo.claimDocument(documentId))) {
        this.logger.log(`${doc.fileName}: no longer waiting (cancelled?), not extracted`);
        return;
      }
      await this.extract(doc, type, controller.signal, options, entry);
    } finally {
      // The parts split from this file ran under the same entry.
      for (const [id, e] of this.running) if (e === entry) this.running.delete(id);
      finish();
    }
  }

  private async extract(doc: ShipmentDocument, type: ExtractableType | undefined, signal: AbortSignal, { willRetry = false, runId, queuedAt }: ProcessOptions, entry: Running): Promise<void> {
    const documentId = doc.id;
    const run = this.progress.run('extraction', doc.shipmentId, { documentId, runId });
    await run.emit({ stage: 'queued', status: 'done', durationMs: queuedAt ? Math.max(0, Date.now() - queuedAt) : 0 });
    await this.repo.refreshShipmentStatus(doc.shipmentId);
    const started = Date.now();
    let parts: ShipmentDocument[] = [];
    let stored: StoredDocument | undefined;
    let bytes: Buffer | undefined;
    try {
      bytes = await this.storage.get(doc.storageKey);
      stored = await readStoredDocument(new Uint8Array(bytes), doc.format ?? 'PDF', doc.fileName, { onProgress: run.report, signal });
      let pages = doc.pages;
      // A first extraction of a file that holds several documents: this document keeps the first part,
      // and each other part becomes a document of its own that shares the file (split.ts).
      if (!pages && !type) {
        const found = documentParts(stored).filter((p) => p.pages.length);
        if (found.length > 1) {
          pages = found[0].pages;
          for (const part of found.slice(1)) {
            const sibling: ShipmentDocument = {
              ...doc, id: randomUUID(), fileName: partName(doc.fileName, part.pages, stored), pages: part.pages, sourceDocumentId: documentId,
              status: 'EXTRACTING', detectedType: 'UNKNOWN', typeConfidence: 0, pageCount: 0,
            };
            delete sibling.error;
            await this.repo.insertDocument(sibling);
            // A cancel of any part stops the job that extracts them all.
            this.running.set(sibling.id, entry);
            parts.push(sibling);
          }
          // Only once every part exists: a retry of a document with pages would not split it again.
          await this.repo.setDocumentPages(documentId, pages);
          this.logger.log(`${doc.fileName}: ${found.length} documents in one file (${found.map((f) => `${f.type} ${f.pages.join(',')}`).join('; ')})`);
        }
      }
      await this.extractAndSave(doc, stored, bytes, pages, type, run, signal);
      this.logger.log(`${doc.fileName}: done in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (err) {
      // A cancelled extraction is never retried, whatever error the abort caused on the way out.
      const cancelled = signal.aborted;
      const retry = willRetry && !cancelled && parts.length === 0;
      const message = cancelled ? CANCELLED_ERROR : errorText(err);
      await this.repo.updateDocumentStatus(documentId, retry ? 'QUEUED' : 'FAILED', message);
      for (const part of parts) await this.repo.updateDocumentStatus(part.id, 'FAILED', message);
      await run.fail(cancelled ? new ExtractionCancelledError() : err, 'saved', retry ? { willRetry } : cancelled ? { reason: 'cancelled' } : {});
      if (retry) await run.emit({ stage: 'queued', status: 'started', detail: { reason: 'retry' } });
      this.logger.warn(`${doc.fileName}: ${message}${retry ? ' (will retry)' : ''}`);
      parts = [];
      throw cancelled ? new ExtractionCancelledError() : err;
    } finally {
      // The other parts of the file, one after the other, each with its own progress run.
      for (const part of parts) {
        const partRun = this.progress.run('extraction', doc.shipmentId, { documentId: part.id });
        await partRun.emit({ stage: 'queued', status: 'done', durationMs: 0 });
        await partRun.emit({ stage: 'reading', status: 'done', durationMs: 0, detail: { pages: part.pages!.length } });
        try {
          signal.throwIfAborted();
          await this.extractAndSave(part, stored!, bytes!, part.pages, undefined, partRun, signal);
        } catch (err) {
          const message = signal.aborted ? CANCELLED_ERROR : errorText(err);
          await this.repo.updateDocumentStatus(part.id, 'FAILED', message);
          await partRun.fail(err, 'saved', signal.aborted ? { reason: 'cancelled' } : {});
          this.logger.warn(`${part.fileName}: ${message}`);
        }
      }
      await this.repo.refreshShipmentStatus(doc.shipmentId);
    }
  }

  /** Extracts one document (all of its file, or `pages` of it) and saves the extraction. */
  private async extractAndSave(doc: ShipmentDocument, stored: StoredDocument, bytes: Buffer, pages: number[] | undefined, type: ExtractableType | undefined, run: ProgressRun<'extraction'>, signal: AbortSignal): Promise<void> {
    const documentId = doc.id;
    // The ISF as it is now: the one read from this PDF replaces it only if nobody changes it meanwhile.
    const isfSince = await this.repo.isfVersion(doc.shipmentId);
    const { pdf, ...result }: ExtractionResult = await extractPart(stored, pages, this.llm, type, { onProgress: run.report, signal });
    // An ISF filing confirmation becomes the shipment's ISF (US only), replacing the earlier one.
    let isf: Isf | undefined;
    if (result.documentType === 'ISF' && result.data) {
      const shipment = await this.repo.findShipment(doc.shipmentId);
      if (shipment?.destination === 'US') isf = result.data as Isf;
      else result.issues.push('Not used: the ISF only applies to US-bound shipments');
    }
    // Signature and stamp: a layout check on the paper (not for spreadsheets). Best effort.
    let attestation: Attestation | undefined;
    if (ATTESTED.includes(result.documentType) && doc.format !== 'SPREADSHEET') {
      attestation = await detectAttestation(new Uint8Array(bytes), pdf, pages).catch((err: Error) => {
        this.logger.warn(`${doc.fileName}: signature check failed: ${err.message}`);
        return undefined;
      });
    }
    signal.throwIfAborted();
    const saved = await startStage(run.report, 'saved');
    await this.repo.saveExtraction(
      documentId,
      {
        pageCount: pages?.length ?? pdf.pageCount,
        detectedType: result.documentType,
        typeConfidence: result.typeConfidence,
        language: (result.data as CommercialInvoice | null)?.language,
      },
      {
        documentId,
        documentType: result.documentType,
        model: result.usage || result.cached || doc.format !== 'SPREADSHEET' ? this.llm.provider.id : 'spreadsheet',
        promptVersion: PROMPT_VERSION,
        raw: result.raw,
        data: result.data,
        issues: result.issues,
        pdfLines: pdf.lines,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        attestation,
      },
      isf && { shipmentId: doc.shipmentId, data: isf, since: isfSince },
    );
    await saved.done({ documentType: result.documentType, normalized: result.data !== null, pages: pages?.length ?? pdf.pageCount });
  }

  /**
   * Documents a previous process left half done (in-process extraction does not survive a restart).
   * Their progress runs end too, so no activity panel shows them running forever.
   */
  async failInterrupted(): Promise<void> {
    const docs = await this.repo.failInterruptedDocuments();
    for (const d of docs) {
      const latest = await this.progressRepo.latestExtractionRun(d.shipmentId, d.id).catch(() => undefined);
      if (latest && !latest.ended) await this.progress.run('extraction', d.shipmentId, { documentId: d.id, runId: latest.runId }).emit({ stage: 'saved', status: 'failed', durationMs: 0, detail: { error: d.error } });
    }
    if (docs.length) this.logger.warn(`${docs.length} document(s) were left extracting by a previous run; marked FAILED`);
  }
}
