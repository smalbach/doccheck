import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
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
  queue(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ReviewQueueQuery)) query: ReviewQueueQuery) {
    return this.review.queue(user.id, query.limit, query.offset);
  }

  /** { documents, fields, threshold }: the dashboard counters. */
  @Get('review/summary')
  summary(@CurrentUser() user: PublicUser) {
    return this.review.summary(user.id);
  }

  /** A document's scored fields (low ones first, with where each is printed and its check) and the next document in the queue. */
  @Get('review/documents/:documentId')
  document(@CurrentUser() user: PublicUser, @Param('documentId') documentId: string) {
    return this.review.document(user.id, documentId);
  }

  /** { paths: ["/invoiceTotal/amount"] }: the values are right as read. */
  @Post('review/documents/:documentId/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: PublicUser, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(AcceptFieldsDto)) dto: AcceptFieldsDto) {
    return this.review.accept(user.id, documentId, dto.paths);
  }

  /** Undoes the accepts on a document: its low fields are back in the queue. */
  @Delete('review/documents/:documentId/accept')
  reopen(@CurrentUser() user: PublicUser, @Param('documentId') documentId: string) {
    return this.review.reopen(user.id, documentId);
  }

  /** What supplier learning has kept for this account: the examples per supplier. */
  @Get('suppliers/examples')
  suppliers(@CurrentUser() user: PublicUser) {
    return this.review.suppliers(user.id);
  }

  /** Forgets a supplier's examples. */
  @Delete('suppliers/examples/:key')
  forget(@CurrentUser() user: PublicUser, @Param('key') key: string) {
    return this.review.forgetSupplier(user.id, key);
  }
}
