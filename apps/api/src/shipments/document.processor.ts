import { Inject, Injectable, Logger } from '@nestjs/common';
import { extractDocument, PROMPT_VERSION, type ExtractableType, type LlmClient } from '@doccheck/extraction';
import { startStage, type CommercialInvoice, type Isf } from '@doccheck/schemas';
import { InjectLlm } from '../llm/llm.module';
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

/**
 * Extracts one stored document: PDF from storage -> local model -> extraction row in Postgres.
 * An ISF PDF is also saved as the shipment's ISF (source 'pdf'), which X11 reads.
 */
@Injectable()
export class DocumentProcessor {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly repo: ShipmentsRepository,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @InjectLlm() private readonly llm: LlmClient,
    private readonly progress: ProgressService,
  ) {}

  /**
   * `type` skips classification, for a document whose type the user corrected. `willRetry` says the
   * queue will run this job again if it fails: the document then stays QUEUED, so a re-extraction is
   * refused until the retry is done instead of being overwritten by it. Every stage is reported as a
   * progress event (docs/PROGRESS-EVENTS.md).
   */
  async process(documentId: string, type?: ExtractableType, { willRetry = false, runId, queuedAt }: ProcessOptions = {}): Promise<void> {
    const doc = await this.repo.findDocument(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    const run = this.progress.run('extraction', doc.shipmentId, { documentId, runId });
    await run.emit({ stage: 'queued', status: 'done', durationMs: queuedAt ? Math.max(0, Date.now() - queuedAt) : 0 });
    await this.repo.updateDocumentStatus(documentId, 'EXTRACTING');
    await this.repo.refreshShipmentStatus(doc.shipmentId);
    // The ISF as it is now: the one read from this PDF replaces it only if nobody changes it meanwhile.
    const isfSince = await this.repo.isfVersion(doc.shipmentId);
    const started = Date.now();
    try {
      const bytes = await this.storage.get(doc.storageKey);
      const { pdf, ...result } = await extractDocument(new Uint8Array(bytes), this.llm, type, { onProgress: run.report });
      // An ISF filing confirmation becomes the shipment's ISF (US only), replacing the earlier one.
      let isf: Isf | undefined;
      if (result.documentType === 'ISF' && result.data) {
        const shipment = await this.repo.findShipment(doc.shipmentId);
        if (shipment?.destination === 'US') isf = result.data as Isf;
        else result.issues.push('Not used: the ISF only applies to US-bound shipments');
      }
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
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateDocumentStatus(documentId, willRetry ? 'QUEUED' : 'FAILED', message);
      await run.fail(err, 'saved', willRetry ? { willRetry } : {});
      if (willRetry) await run.emit({ stage: 'queued', status: 'started', detail: { reason: 'retry' } });
      this.logger.warn(`${doc.fileName}: ${message}${willRetry ? ' (will retry)' : ''}`);
      throw err;
    } finally {
      await this.repo.refreshShipmentStatus(doc.shipmentId);
    }
  }

  /** Documents a previous process left half done (in-process extraction does not survive a restart). */
  async failInterrupted(): Promise<void> {
    const n = await this.repo.failInterruptedDocuments();
    if (n) this.logger.warn(`${n} document(s) were left extracting by a previous run; marked FAILED`);
  }
}
