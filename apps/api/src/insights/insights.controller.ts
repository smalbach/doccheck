import { Controller, Get, Query } from '@nestjs/common';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LinesQuery, ShipmentDataQuery, SummaryQuery } from './insights.dto';
import { InsightsRepository } from './insights.repository';

/**
 * The extracted data of all of the user's shipments in one place: totals, every invoice line and the
 * key figures of each shipment. Per shipment, the latest extracted document of each type counts, as in validation.
 */
@Controller('insights')
export class InsightsController {
  constructor(private readonly repo: InsightsRepository) {}

  @Get('summary')
  summary(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(SummaryQuery)) query: SummaryQuery) {
    return this.repo.summary(user.id, query);
  }

  /** ?q=text&origin=CN&hs=9503&destination=CA&limit=50&offset=0 */
  @Get('lines')
  lines(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(LinesQuery)) query: LinesQuery) {
    return this.repo.lines(user.id, query);
  }

  /** ?q=text&destination=CA&limit=50&offset=0 */
  @Get('shipments')
  shipments(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ShipmentDataQuery)) query: ShipmentDataQuery) {
    return this.repo.shipments(user.id, query);
  }
}
