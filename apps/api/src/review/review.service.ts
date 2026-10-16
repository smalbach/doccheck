import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import {
  DEFAULT_REVIEW_THRESHOLD, DEFAULT_SUPPLIER_EXAMPLES, detectSupplier, EXTRACTABLE_TYPES, exampleFromCorrection, fieldConfidence, supplierKey,
  type ExtractableType, type FieldConfidence, type PdfText, type SupplierContext, type SupplierExample, type TextLine,
} from '@doccheck/extraction';
import { readPointer } from '@doccheck/schemas';
import { AuditService } from '../audit/audit.service';
import { isDemo } from '../demo/demo-mode';
import { ReviewRepository } from './review.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where each document type prints the supplier: the company the examples are learned for. */
const SUPPLIER_FIELD: Partial<Record<ExtractableType, string[]>> = {
  COMMERCIAL_INVOICE: ['/seller/name'],
  PACKING_LIST: ['/seller/name'],
  BILL_OF_LADING: ['/shipper/name'],
  ISF: ['/seller/name', '/manufacturer/name'],
};

const isExtractable = (t: string): t is ExtractableType => (EXTRACTABLE_TYPES as string[]).includes(t);

export const reviewThreshold = () => {
  const t = Number(process.env.REVIEW_THRESHOLD);
  return Number.isFinite(t) && t > 0 && t <= 1 ? t : DEFAULT_REVIEW_THRESHOLD;
};
const learningOn = () => process.env.SUPPLIER_LEARNING === 'true';
const exampleLimit = () => {
  const n = Number(process.env.SUPPLIER_EXAMPLES);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SUPPLIER_EXAMPLES;
};

/** What an extraction hands over to score its fields. */
export interface ScoredExtraction {
  documentId: string;
  documentType: string;
  raw: unknown;
  data: unknown;
  partial?: unknown;
  issues: string[];
  pdf: PdfText;
  logprobs?: Record<string, number>;
  secondRaw?: unknown;
}

/** The extraction of a document being corrected (ShipmentsService.correct). */
export interface CorrectedExtraction {
  documentId: string;
  documentType: string;
  raw: unknown;
  data: unknown;
  pdfLines: TextLine[];
}

/**
 * The human review queue (fields the extraction is not sure of, checked by a person) and supplier
 * learning (corrections given back to the model as examples for the same supplier).
 */
@Injectable()
export class ReviewService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly repo: ReviewRepository,
    private readonly audit: AuditService,
  ) {}

  /** Documents extracted before field confidence existed are scored once, in the background. */
  onApplicationBootstrap() {
    if (isDemo() || process.env.REVIEW_BACKFILL === 'false') return;
    void this.backfill().catch((err) => this.logger.warn(`Field confidence backfill stopped: ${err instanceof Error ? err.message : String(err)}`));
  }

  async backfill(batch = 200): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.repo.unscored(batch);
      for (const r of rows) {
        // The page text was stored; the OCR pages and confidence are in the extraction's first issue.
        const ocr = r.issues.map((i) => /^Read with OCR \(pages? ([\d, ]+?)(?:, confidence (\d+)%)?\)/.exec(i)).find(Boolean);
        const pdf: PdfText = {
          pageCount: r.pageCount,
          lines: r.pdfLines,
          text: '',
          ...(ocr ? { ocrPages: ocr[1]!.split(',').map((p) => Number(p.trim())), ...(ocr[2] ? { ocrConfidence: Number(ocr[2]) } : {}) } : {}),
        };
        const fields = await this.scoreExtraction({ documentId: r.documentId, documentType: r.documentType, raw: r.raw, data: r.data, issues: r.issues, pdf });
        // A type with nothing to score still gets a row, so it is not picked again.
        if (fields.length === 0) await this.repo.saveConfidence(r.documentId, []);
      }
      total += rows.length;
      if (rows.length < batch) break;
    }
    if (total) this.logger.log(`Field confidence computed for ${total} earlier document(s)`);
    return total;
  }

  // Called by the extraction.

  /** Scores the fields of a new extraction and stores them; never fails the extraction. */
  async scoreExtraction(e: ScoredExtraction): Promise<FieldConfidence[]> {
    if (!isExtractable(e.documentType)) return [];
    try {
      const fields = fieldConfidence({ type: e.documentType, documentId: e.documentId, raw: e.raw, data: e.data ?? e.partial ?? {}, pdf: e.pdf, issues: e.issues, logprobs: e.logprobs, secondRaw: e.secondRaw });
      await this.repo.saveConfidence(e.documentId, fields);
      return fields;
    } catch (err) {
      this.logger.warn(`Field confidence not stored for ${e.documentId}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** The examples of the supplier this document comes from, if supplier learning is on and the supplier is known. */
  async supplierContext(shipmentId: string, pdf: PdfText, type: ExtractableType): Promise<SupplierContext | undefined> {
    if (!learningOn()) return undefined;
    // Only the examples of the shipment's own organization.
    const orgId = await this.repo.shipmentOrg(shipmentId);
    if (!orgId) return undefined;
    const supplier = detectSupplier(pdf, await this.repo.suppliers(orgId));
    if (!supplier) return undefined;
    const examples = await this.repo.examples(orgId, supplier.key, type, exampleLimit());
    return examples.length ? { supplier: supplier.name, examples } : undefined;
  }

  // Called by the corrections.

  /**
   * A correction was saved: the corrected fields count as reviewed, and with supplier learning on each
   * corrected value becomes an example for the supplier's next documents.
   */
  async onCorrected(userId: string, e: CorrectedExtraction, corrections: { path: string; newValue: unknown }[]): Promise<void> {
    try {
      const scored = await this.repo.scoredPaths(e.documentId);
      const reviewed = corrections.map((c) => c.path).filter((p) => scored.has(p));
      await this.repo.saveReviews(e.documentId, userId, reviewed, 'corrected');
      if (reviewed.length) this.audit.note({ action: 'review.correct', entity: 'document', entityId: e.documentId, after: { paths: reviewed } });
      if (!learningOn() || !isExtractable(e.documentType)) return;
      const name = (SUPPLIER_FIELD[e.documentType] ?? []).map((p) => readPointer(e.data, p)).find((v): v is string => typeof v === 'string' && v.trim() !== '');
      if (!name || !supplierKey(name)) return;
      const examples = corrections
        .map((c) => exampleFromCorrection({ documentType: e.documentType as ExtractableType, path: c.path, newValue: c.newValue, raw: e.raw, pdf: { lines: e.pdfLines } }))
        .filter((x): x is SupplierExample => !!x);
      await this.repo.saveExamples(userId, { key: supplierKey(name), name: name.trim() }, e.documentId, examples);
    } catch (err) {
      this.logger.warn(`Review or supplier example not stored for ${e.documentId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The model's values are back: nothing on the document is corrected any more, and its examples go. */
  async onReverted(documentId: string): Promise<void> {
    await this.repo.dropReviews(documentId, 'corrected');
    await this.repo.forgetDocumentExamples(documentId);
  }

  // The queue.

  queue(orgId: string, limit: number, offset: number) {
    return this.repo.queue(orgId, reviewThreshold(), limit, offset).then((q) => ({ ...q, threshold: reviewThreshold(), limit, offset }));
  }

  summary(orgId: string) {
    return this.repo.counts(orgId, reviewThreshold()).then((c) => ({ documents: c.total, fields: c.fields, threshold: reviewThreshold() }));
  }

  /** A document to review: its fields under the threshold first, each with its check if any, and the next document. */
  async document(orgId: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.document(orgId, documentId) : null;
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    const threshold = reviewThreshold();
    const reviews = new Map(doc.reviews.map((r) => [r.path, r]));
    const fields = doc.fields
      .map((f) => {
        // `value` is the document's value now; `modelValue` what the extraction read (and was scored on).
        const now = readPointer(doc.data, f.path);
        const value = typeof now === 'string' || typeof now === 'number' ? now : null;
        return { ...f, value, modelValue: f.value, low: f.confidence < threshold, ...(reviews.get(f.path) ? { review: reviews.get(f.path) } : {}) };
      })
      .sort((a, b) => Number(b.low) - Number(a.low) || a.confidence - b.confidence);
    const { reviews: _, data: __, ...rest } = doc;
    return { ...rest, threshold, fields, next: await this.repo.nextInQueue(orgId, threshold, documentId) };
  }

  /** Marks fields as checked and right as read. Only fields the document has a confidence for. */
  async accept(orgId: string, userId: string, documentId: string, paths: string[]) {
    const doc = UUID.test(documentId) ? await this.repo.document(orgId, documentId) : null;
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.status !== 'EXTRACTED') throw new BadRequestException('The document is not extracted');
    const known = new Set(doc.fields.map((f) => f.path));
    const unknown = paths.filter((p) => !known.has(p));
    if (unknown.length) throw new BadRequestException({ message: 'Not fields of this document', issues: unknown.map((path) => ({ path, message: 'Not a scored field' })) });
    await this.repo.saveReviews(documentId, userId, [...new Set(paths)], 'accepted');
    this.audit.note({ orgId, action: 'review.accept', entity: 'document', entityId: documentId, after: { paths: [...new Set(paths)] } });
    return this.document(orgId, documentId);
  }

  /** Puts fields back in the queue (an accept made by mistake). */
  async reopen(orgId: string, documentId: string) {
    const doc = UUID.test(documentId) ? await this.repo.document(orgId, documentId) : null;
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    await this.repo.dropReviews(documentId, 'accepted');
    this.audit.note({ orgId, action: 'review.reopen', entity: 'document', entityId: documentId });
    return this.document(orgId, documentId);
  }

  // What was learned.

  async suppliers(orgId: string) {
    const rows = await this.repo.listExamples(orgId);
    const bySupplier = new Map<string, { key: string; name: string; examples: typeof rows }>();
    for (const r of rows) {
      const entry = bySupplier.get(r.supplierKey) ?? { key: r.supplierKey, name: r.supplierName, examples: [] };
      entry.examples.push(r);
      bySupplier.set(r.supplierKey, entry);
    }
    return { enabled: learningOn(), limit: exampleLimit(), suppliers: [...bySupplier.values()] };
  }

  async forgetSupplier(orgId: string, key: string) {
    if (!(await this.repo.deleteSupplier(orgId, key))) throw new NotFoundException(`No examples for ${key}`);
    this.audit.note({ orgId, action: 'supplier.forget', entity: 'supplier', entityId: key });
    return this.suppliers(orgId);
  }
}
