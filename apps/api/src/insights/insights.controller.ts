import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { csvAttachment, toCsv } from '../common/csv';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CSV_MAX_ROWS, GOODS_CSV_COLUMNS, SHIPMENTS_CSV_COLUMNS } from './insights.csv';
import { EntitiesRepository } from './entities.repository';
import { ContainersQuery, EntityQuery, LinesCsvQuery, LinesQuery, PartiesQuery, ProductsQuery, ShipmentDataCsvQuery, ShipmentDataQuery, SummaryQuery } from './insights.dto';
import { InsightsRepository } from './insights.repository';

/**
 * The extracted data of all of the organization's shipments in one place: totals, every invoice line and the
 * key figures of each shipment. Per shipment, the latest extracted document of each type counts, as in validation.
 */
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly repo: InsightsRepository,
    private readonly entities: EntitiesRepository,
  ) {}

  @Get('summary')
  summary(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(SummaryQuery)) query: SummaryQuery) {
    return this.repo.summary(org.id, query);
  }

  /** ?q=text&origin=CN&hs=9503&destination=CA&limit=50&offset=0 */
  @Get('lines')
  lines(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(LinesQuery)) query: LinesQuery) {
    return this.repo.lines(org.id, query);
  }

  /** ?q=text&destination=CA&limit=50&offset=0 */
  @Get('shipments')
  shipments(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ShipmentDataQuery)) query: ShipmentDataQuery) {
    return this.repo.shipments(org.id, query);
  }

  /** Every matching invoice line (up to CSV_MAX_ROWS) as a CSV download; the filters of /lines, no paging. */
  @Get('lines.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async linesCsv(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(LinesCsvQuery)) query: LinesCsvQuery, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.repo.lines(org.id, { ...query, limit: CSV_MAX_ROWS, offset: 0 });
    res.setHeader('content-disposition', csvAttachment('doccheck-goods'));
    return toCsv(GOODS_CSV_COLUMNS, items);
  }

  /** Every matching shipment (up to CSV_MAX_ROWS) as a CSV download; the filters of /shipments, no paging. */
  @Get('shipments.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async shipmentsCsv(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ShipmentDataCsvQuery)) query: ShipmentDataCsvQuery, @Res({ passthrough: true }) res: Response) {
    const { items } = await this.repo.shipments(org.id, { ...query, limit: CSV_MAX_ROWS, offset: 0 });
    res.setHeader('content-disposition', csvAttachment('doccheck-shipments'));
    return toCsv(SHIPMENTS_CSV_COLUMNS, items);
  }

  /** Containers on the bills of lading. ?q=number, seal, B/L, carrier, vessel&destination=CA&limit=50&offset=0 */
  @Get('containers')
  containers(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ContainersQuery)) query: ContainersQuery) {
    return this.repo.containers(org.id, query);
  }

  /** Companies across the organization's shipments. ?q=text&role=supplier|customer&destination=CA&limit=50&offset=0 */
  @Get('parties')
  parties(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(PartiesQuery)) query: PartiesQuery) {
    return this.entities.parties(org.id, query);
  }

  /** One company: figures, the products it sold or bought, its shipments. */
  @Get('parties/:id')
  async party(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(EntityQuery)) query: EntityQuery) {
    const party = await this.entities.party(org.id, id, query);
    if (!party) throw new NotFoundException('Party not found');
    return party;
  }

  /** Products across the organization's invoices. ?q=text&origin=CN&hs=9503&destination=CA&limit=50&offset=0 */
  @Get('products')
  products(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ProductsQuery)) query: ProductsQuery) {
    return this.entities.products(org.id, query);
  }

  /** One product: figures, price statistics and every purchase (its price history). */
  @Get('products/:id')
  async product(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(EntityQuery)) query: EntityQuery) {
    const product = await this.entities.product(org.id, id, query);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }
}
