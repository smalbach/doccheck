import { Inject, Injectable, Logger } from '@nestjs/common';
import { extractDocument, PROMPT_VERSION, type ExtractableType, type LlmClient } from '@doccheck/extraction';
import type { CommercialInvoice } from '@doccheck/schemas';
import { InjectLlm } from '../llm/llm.module';
import { STORAGE, type ObjectStorage } from '../storage/storage';
import { ShipmentsRepository } from './shipments.repository';

/** Extracts one stored document: PDF from storage -> local model -> extraction row in Postgres. */
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
    const started = Date.now();
    try {
      const bytes = await this.storage.get(doc.storageKey);
      const { pdf, ...result } = await extractDocument(new Uint8Array(bytes), this.llm, type);
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
}
