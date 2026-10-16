import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { csvAttachment, toCsv, type CsvColumn } from '../common/csv';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { isDemo } from '../demo/demo-mode';
import { AnalyticsQuery, AskBody, CostAssumptionsBody, PriceGroupQuery, PricesQuery } from './analytics.dto';
import { AnalyticsRepository } from './analytics.repository';
import type { CostReport, KpiGroup, SupplierRow } from './analytics.types';
import { estimateCost } from './cost/cost';
import { CostAssumptions, DEFAULT_COST_ASSUMPTIONS } from './cost/penalties';
import { PricesRepository } from './prices.repository';
import { QaService } from './qa/qa.service';
import { SqlRejected } from './qa/sql-guard';
import { RegulationWatchService } from './regwatch/regwatch.service';
import { z } from 'zod';

type KpiCsvRow = KpiGroup & { breakdown: string };
const KPI_CSV_COLUMNS: readonly CsvColumn<KpiCsvRow>[] = [
  { header: 'Breakdown', value: (r) => r.breakdown },
  { header: 'Key', value: (r) => r.key },
  { header: 'Label', value: (r) => r.label },
  { header: 'Validated shipments', value: (r) => r.shipments },
  { header: 'Shipments with findings on first validation', value: (r) => r.withFindings },
  { header: 'Findings on first validation', value: (r) => r.findings },
  { header: 'Error rate %', value: (r) => (r.shipments ? ((100 * r.withFindings) / r.shipments).toFixed(1) : undefined) },
];

const SUPPLIER_CSV_COLUMNS: readonly CsvColumn<SupplierRow>[] = [
  { header: 'Rank', value: (r) => r.rank },
  { header: 'Supplier', value: (r) => r.name },
  { header: 'Country', value: (r) => r.country },
  { header: 'Score', value: (r) => r.score.score },
  { header: 'Validated shipments', value: (r) => r.validatedShipments },
  { header: 'Clean on first validation', value: (r) => r.cleanFirstPass },
  { header: 'Findings', value: (r) => r.findings },
  { header: 'Findings asked to correct', value: (r) => r.requestedFindings },
  { header: 'Corrected', value: (r) => r.correctedFindings },
  { header: 'Requests', value: (r) => r.requests },
  { header: 'Answered', value: (r) => r.answered },
  { header: 'Median response hours', value: (r) => r.medianResponseHours },
];

const RunBody = z.object({ sql: z.string().min(1).max(4000) });

/**
 * Analytics over the account's validation history (docs/ANALYTICS.md): KPIs, supplier scorecard,
 * cost avoided, price benchmark, questions in plain language and regulation changes. Every query is
 * scoped to the signed-in account.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly prices: PricesRepository,
    private readonly qa: QaService,
    private readonly regulations: RegulationWatchService,
  ) {}

  /** ?destination=CA&from=2026-01-01&to=2026-03-31 */
  @Get('kpis')
  kpis(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    return this.repo.kpis(user.id, q);
  }

  /** Every breakdown of /kpis as rows of one CSV. */
  @Get('kpis.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async kpisCsv(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery, @Res({ passthrough: true }) res: Response) {
    const k = await this.repo.kpis(user.id, q);
    const months: KpiCsvRow[] = k.months.map((m) => ({ breakdown: 'month', key: m.month, shipments: m.shipments, withFindings: m.shipments - m.clean, findings: m.findings }));
    const rows: KpiCsvRow[] = [
      ...months,
      ...(['byRule', 'byDocumentType', 'bySupplier', 'byOrigin', 'byRoute'] as const).flatMap((b) => k[b].map((g) => ({ ...g, breakdown: b.slice(2).replace(/^./, (c) => c.toLowerCase()) }))),
    ];
    res.setHeader('content-disposition', csvAttachment('doccheck-kpis'));
    return toCsv(KPI_CSV_COLUMNS, rows);
  }

  @Get('suppliers')
  suppliers(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    return this.repo.suppliers(user.id, q);
  }

  @Get('suppliers.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async suppliersCsv(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', csvAttachment('doccheck-suppliers'));
    return toCsv(SUPPLIER_CSV_COLUMNS, await this.repo.suppliers(user.id, q));
  }

  @Get('suppliers/:id')
  async supplier(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    const s = await this.repo.supplier(user.id, id, q);
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  @Get('cost')
  async cost(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery): Promise<CostReport> {
    const [saved, inputs] = await Promise.all([this.repo.costSettings(user.id), this.repo.costInputs(user.id, q)]);
    const parsed = saved ? CostAssumptions.safeParse(saved) : undefined;
    const assumptions = parsed?.success ? parsed.data : DEFAULT_COST_ASSUMPTIONS;
    return { ...estimateCost(inputs.shipments, inputs.findings, assumptions), assumptions, defaults: !parsed?.success, shipments: inputs.shipments.length };
  }

  @Get('cost/defaults')
  costDefaults() {
    return DEFAULT_COST_ASSUMPTIONS;
  }

  /** Saves the account's assumptions; { assumptions: null } goes back to the defaults. */
  @Put('cost/assumptions')
  @HttpCode(204)
  async saveCost(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CostAssumptionsBody)) body: CostAssumptionsBody) {
    if (isDemo()) throw new ForbiddenException('The demo is read-only');
    const ids = body.assumptions?.penalties.map((p) => p.id) ?? [];
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each penalty needs its own id');
    await this.repo.saveCostSettings(user.id, body.assumptions);
  }

  @Delete('cost/assumptions')
  @HttpCode(204)
  async resetCost(@CurrentUser() user: PublicUser) {
    if (isDemo()) throw new ForbiddenException('The demo is read-only');
    await this.repo.saveCostSettings(user.id, null);
  }

  /** ?by=product|hs6&q=text&outliers=true&destination=CA */
  @Get('prices')
  priceGroups(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(PricesQuery)) q: PricesQuery) {
    return this.prices.groups(user.id, q);
  }

  /** One group's prices: ?by=product&key=<id or hs6:origin>&currency=USD&unit=PCS */
  @Get('prices/group')
  async priceGroup(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(PriceGroupQuery)) q: PriceGroupQuery) {
    const g = await this.prices.group1(user.id, q);
    if (!g) throw new NotFoundException('No prices in this group');
    return g;
  }

  /** A question in plain language: the model writes SQL, the guard checks it, it runs scoped to the account. */
  @Post('qa')
  @HttpCode(200)
  ask(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(AskBody)) body: AskBody) {
    return this.qa.ask(user.id, body.question);
  }

  /** Runs SQL the user edited, behind the same guard and scope. */
  @Post('qa/run')
  @HttpCode(200)
  async run(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(RunBody)) body: z.infer<typeof RunBody>) {
    try {
      return { sql: body.sql, ...(await this.qa.runner.run(user.id, body.sql)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({ message: err instanceof SqlRejected ? `Not allowed: ${message}` : `The query did not run: ${message}`, code: err instanceof SqlRejected ? 'sql_rejected' : 'sql_failed' });
    }
  }

  @Get('regulations')
  regulationChanges(@CurrentUser() user: PublicUser) {
    return this.regulations.changes(user.id);
  }

  @Get('regulations/unread')
  async regulationUnread(@CurrentUser() user: PublicUser) {
    return { unread: await this.regulations.unread(user.id) };
  }

  @Post('regulations/read')
  @HttpCode(204)
  async regulationRead(@CurrentUser() user: PublicUser) {
    if (!isDemo()) await this.regulations.markRead(user.id);
  }

  /** Admins: check the corpus now instead of waiting for the schedule. */
  @Post('regulations/check')
  @UseGuards(AdminGuard)
  async regulationCheck() {
    if (isDemo()) throw new ForbiddenException('The demo is read-only');
    try {
      return await this.regulations.check('manual');
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }
}
