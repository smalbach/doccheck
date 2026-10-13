import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { csvAttachment, toCsv } from '../common/csv';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CSV_MAX_ROWS, GOODS_CSV_COLUMNS, SHIPMENTS_CSV_COLUMNS } from './insights.csv';
import { LinesCsvQuery, LinesQuery, ShipmentDataCsvQuery, ShipmentDataQuery, SummaryQuery } from './insights.dto';
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

  /** Every matching invoice line (up to CSV_MAX_ROWS) as a CSV download; the filters of /lines, no paging. */
  @Get('lines.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async linesCsv(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(LinesCsvQuery)) query: LinesCsvQuery, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.repo.lines(user.id, { ...query, limit: CSV_MAX_ROWS, offset: 0 });
    res.setHeader('content-disposition', csvAttachment('doccheck-goods'));
    return toCsv(GOODS_CSV_COLUMNS, items);
  }

  /** Every matching shipment (up to CSV_MAX_ROWS) as a CSV download; the filters of /shipments, no paging. */
  @Get('shipments.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async shipmentsCsv(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ShipmentDataCsvQuery)) query: ShipmentDataCsvQuery, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.repo.shipments(user.id, { ...query, limit: CSV_MAX_ROWS, offset: 0 });
    res.setHeader('content-disposition', csvAttachment('doccheck-shipments'));
    return toCsv(SHIPMENTS_CSV_COLUMNS, items);
  }
}
