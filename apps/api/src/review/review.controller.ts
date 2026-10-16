import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
import { AcceptFieldsDto, ReviewQueueQuery } from './review.dto';
import { ReviewService } from './review.service';

/**
 * The review queue: documents whose extraction is unsure of some values. Values are corrected with
 * PATCH /shipments/:id/documents/:documentId/data, as anywhere else (same schema check and audit);
 * a corrected field counts as reviewed.
 */
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  /** ?limit=25&offset=0 → { items (least sure first), total documents, fields to check, threshold }. */
  @Get('review/queue')
  @Permission('data.read')
  queue(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ReviewQueueQuery)) query: ReviewQueueQuery) {
    return this.review.queue(org.id, query.limit, query.offset);
  }

  /** { documents, fields, threshold }: the dashboard counters. */
  @Get('review/summary')
  @Permission('data.read')
  summary(@CurrentOrg() org: OrgContext) {
    return this.review.summary(org.id);
  }

  /** A document's scored fields (low ones first, with where each is printed and its check) and the next document in the queue. */
  @Get('review/documents/:documentId')
  @Permission('data.read')
  document(@CurrentOrg() org: OrgContext, @Param('documentId') documentId: string) {
    return this.review.document(org.id, documentId);
  }

  /** { paths: ["/invoiceTotal/amount"] }: the values are right as read. */
  @Post('review/documents/:documentId/accept')
  @HttpCode(200)
  @Permission('shipment.write')
  accept(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(AcceptFieldsDto)) dto: AcceptFieldsDto) {
    return this.review.accept(org.id, user.id, documentId, dto.paths);
  }

  /** Undoes the accepts on a document: its low fields are back in the queue. */
  @Delete('review/documents/:documentId/accept')
  @Permission('shipment.write')
  reopen(@CurrentOrg() org: OrgContext, @Param('documentId') documentId: string) {
    return this.review.reopen(org.id, documentId);
  }

  /** What supplier learning has kept for the organization: the examples per supplier. */
  @Get('suppliers/examples')
  @Permission('data.read')
  suppliers(@CurrentOrg() org: OrgContext) {
    return this.review.suppliers(org.id);
  }

  /** Forgets a supplier's examples. */
  @Delete('suppliers/examples/:key')
  @Permission('shipment.write')
  forget(@CurrentOrg() org: OrgContext, @Param('key') key: string) {
    return this.review.forgetSupplier(org.id, key);
  }
}
