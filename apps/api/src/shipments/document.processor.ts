import { Inject, Injectable, Logger } from '@nestjs/common';
import { extractDocument, PROMPT_VERSION, type ExtractableType, type LlmClient } from '@doccheck/extraction';
import type { CommercialInvoice, Isf } from '@doccheck/schemas';
import { InjectLlm } from '../llm/llm.module';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ShipmentsRepository } from './shipments.repository';

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
  ) {}

  /** `type` skips classification, for a document whose type the user corrected. */
  async process(documentId: string, type?: ExtractableType): Promise<void> {
    const doc = await this.repo.findDocument(documentId);
    if (!doc) throw new Error(`Document ${documentId} not found`);
    await this.repo.updateDocumentStatus(documentId, 'EXTRACTING');
    await this.repo.refreshShipmentStatus(doc.shipmentId);
    // The ISF as it is now: the one read from this PDF replaces it only if nobody changes it meanwhile.
    const isfSince = await this.repo.isfVersion(doc.shipmentId);
    const started = Date.now();
    try {
      const bytes = await this.storage.get(doc.storageKey);
      const { pdf, ...result } = await extractDocument(new Uint8Array(bytes), this.llm, type);
      // An ISF filing confirmation becomes the shipment's ISF (US only), replacing the earlier one.
      let isf: Isf | undefined;
      if (result.documentType === 'ISF' && result.data) {
        const shipment = await this.repo.findShipment(doc.shipmentId);
        if (shipment?.destination === 'US') isf = result.data as Isf;
        else result.issues.push('Not used: the ISF only applies to US-bound shipments');
      }
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
      this.logger.log(`${doc.fileName}: ${result.documentType} in ${Math.round((Date.now() - started) / 1000)} s${result.data ? '' : ' (not normalized)'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.updateDocumentStatus(documentId, 'FAILED', message);
      this.logger.warn(`${doc.fileName}: ${message}`);
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
