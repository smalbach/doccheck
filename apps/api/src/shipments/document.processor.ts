import { Inject, Injectable, Logger } from '@nestjs/common';
import { extractDocument, PROMPT_VERSION, type ExtractableType, type LlmClient } from '@doccheck/extraction';
import { CANCELLED_ERROR, errorText, startStage, type CommercialInvoice, type Isf, type ShipmentDocument } from '@doccheck/schemas';
import { InjectLlm } from '../llm/llm.module';
import { ProgressRepository } from '../progress/progress.repository';
import { ProgressService } from '../progress/progress.service';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ShipmentsRepository } from './shipments.repository';

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
      await this.extract(doc, type, controller.signal, options);
    } finally {
      if (this.running.get(documentId) === entry) this.running.delete(documentId);
      finish();
    }
  }

  private async extract(doc: ShipmentDocument, type: ExtractableType | undefined, signal: AbortSignal, { willRetry = false, runId, queuedAt }: ProcessOptions): Promise<void> {
    const documentId = doc.id;
    const run = this.progress.run('extraction', doc.shipmentId, { documentId, runId });
    await run.emit({ stage: 'queued', status: 'done', durationMs: queuedAt ? Math.max(0, Date.now() - queuedAt) : 0 });
    await this.repo.refreshShipmentStatus(doc.shipmentId);
    // The ISF as it is now: the one read from this PDF replaces it only if nobody changes it meanwhile.
    const isfSince = await this.repo.isfVersion(doc.shipmentId);
    const started = Date.now();
    try {
      const bytes = await this.storage.get(doc.storageKey);
      const { pdf, ...result } = await extractDocument(new Uint8Array(bytes), this.llm, type, { onProgress: run.report, signal });
      // An ISF filing confirmation becomes the shipment's ISF (US only), replacing the earlier one.
      let isf: Isf | undefined;
      if (result.documentType === 'ISF' && result.data) {
        const shipment = await this.repo.findShipment(doc.shipmentId);
        if (shipment?.destination === 'US') isf = result.data as Isf;
        else result.issues.push('Not used: the ISF only applies to US-bound shipments');
      }
      signal.throwIfAborted();
      const saved = await startStage(run.report, 'saved');
      await this.repo.saveExtraction(
        documentId,
        {
          pageCount: pdf.pageCount,
          detectedType: result.documentType,
          typeConfidence: result.typeConfidence,
          language: (result.data as CommercialInvoice | null)?.language,
        },
        {
          documentId,
          documentType: result.documentType,
          model: this.llm.provider.id,
          promptVersion: PROMPT_VERSION,
          raw: result.raw,
          data: result.data,
          issues: result.issues,
          pdfLines: pdf.lines,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        },
        isf && { shipmentId: doc.shipmentId, data: isf, since: isfSince },
      );
      await saved.done({ documentType: result.documentType, normalized: result.data !== null, pages: pdf.pageCount });
      this.logger.log(`${doc.fileName}: ${result.documentType} in ${Math.round((Date.now() - started) / 1000)} s${result.data ? '' : ' (not normalized)'}`);
    } catch (err) {
      // A cancelled extraction is never retried, whatever error the abort caused on the way out.
      const cancelled = signal.aborted;
      const retry = willRetry && !cancelled;
      const message = cancelled ? CANCELLED_ERROR : errorText(err);
      await this.repo.updateDocumentStatus(documentId, retry ? 'QUEUED' : 'FAILED', message);
      await run.fail(cancelled ? new ExtractionCancelledError() : err, 'saved', retry ? { willRetry } : cancelled ? { reason: 'cancelled' } : {});
      if (retry) await run.emit({ stage: 'queued', status: 'started', detail: { reason: 'retry' } });
      this.logger.warn(`${doc.fileName}: ${message}${retry ? ' (will retry)' : ''}`);
      throw cancelled ? new ExtractionCancelledError() : err;
    } finally {
      await this.repo.refreshShipmentStatus(doc.shipmentId);
    }
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
