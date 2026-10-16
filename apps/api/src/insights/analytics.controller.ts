import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
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
 * Analytics over the organization's validation history (docs/ANALYTICS.md): KPIs, supplier scorecard,
 * cost avoided, price benchmark, questions in plain language and regulation changes. Every query is
 * scoped to the active organization, and every route needs data.read (clients see no analytics);
 * editing the cost assumptions needs org.settings.
 */
@Controller('analytics')
@Permission('data.read')
export class AnalyticsController {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly prices: PricesRepository,
    private readonly qa: QaService,
    private readonly regulations: RegulationWatchService,
  ) {}

  /** ?destination=CA&from=2026-01-01&to=2026-03-31 */
  @Get('kpis')
  kpis(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    return this.repo.kpis(org.id, q);
  }

  /** Every breakdown of /kpis as rows of one CSV. */
  @Get('kpis.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async kpisCsv(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery, @Res({ passthrough: true }) res: Response) {
    const k = await this.repo.kpis(org.id, q);
    const months: KpiCsvRow[] = k.months.map((m) => ({ breakdown: 'month', key: m.month, shipments: m.shipments, withFindings: m.shipments - m.clean, findings: m.findings }));
    const rows: KpiCsvRow[] = [
      ...months,
      ...(['byRule', 'byDocumentType', 'bySupplier', 'byOrigin', 'byRoute'] as const).flatMap((b) => k[b].map((g) => ({ ...g, breakdown: b.slice(2).replace(/^./, (c) => c.toLowerCase()) }))),
    ];
    res.setHeader('content-disposition', csvAttachment('doccheck-kpis'));
    return toCsv(KPI_CSV_COLUMNS, rows);
  }

  @Get('suppliers')
  suppliers(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    return this.repo.suppliers(org.id, q);
  }

  @Get('suppliers.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  async suppliersCsv(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', csvAttachment('doccheck-suppliers'));
    return toCsv(SUPPLIER_CSV_COLUMNS, await this.repo.suppliers(org.id, q));
  }

  @Get('suppliers/:id')
  async supplier(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery) {
    const s = await this.repo.supplier(org.id, id, q);
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  @Get('cost')
  async cost(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(AnalyticsQuery)) q: AnalyticsQuery): Promise<CostReport> {
    const [saved, inputs] = await Promise.all([this.repo.costSettings(org.id), this.repo.costInputs(org.id, q)]);
    const parsed = saved ? CostAssumptions.safeParse(saved) : undefined;
    const assumptions = parsed?.success ? parsed.data : DEFAULT_COST_ASSUMPTIONS;
    return { ...estimateCost(inputs.shipments, inputs.findings, assumptions), assumptions, defaults: !parsed?.success, shipments: inputs.shipments.length };
  }

  @Get('cost/defaults')
  costDefaults() {
    return DEFAULT_COST_ASSUMPTIONS;
  }

  /** Saves the organization's assumptions; { assumptions: null } goes back to the defaults. */
  @Put('cost/assumptions')
  @Permission('org.settings')
  @HttpCode(204)
  async saveCost(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CostAssumptionsBody)) body: CostAssumptionsBody) {
    if (isDemo()) throw new ForbiddenException('The demo is read-only');
    const ids = body.assumptions?.penalties.map((p) => p.id) ?? [];
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each penalty needs its own id');
    await this.repo.saveCostSettings(org.id, user.id, body.assumptions);
  }

  @Delete('cost/assumptions')
  @Permission('org.settings')
  @HttpCode(204)
  async resetCost(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser) {
    if (isDemo()) throw new ForbiddenException('The demo is read-only');
    await this.repo.saveCostSettings(org.id, user.id, null);
  }

  /** ?by=product|hs6&q=text&outliers=true&destination=CA */
  @Get('prices')
  priceGroups(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(PricesQuery)) q: PricesQuery) {
    return this.prices.groups(org.id, q);
  }

  /** One group's prices: ?by=product&key=<id or hs6:origin>&currency=USD&unit=PCS */
  @Get('prices/group')
  async priceGroup(@CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(PriceGroupQuery)) q: PriceGroupQuery) {
    const g = await this.prices.group1(org.id, q);
    if (!g) throw new NotFoundException('No prices in this group');
    return g;
  }

  /** A question in plain language: the model writes SQL, the guard checks it, it runs scoped to the organization. */
  @Post('qa')
  @HttpCode(200)
  ask(@CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(AskBody)) body: AskBody) {
    return this.qa.ask(org.id, body.question);
  }

  /** Runs SQL the user edited, behind the same guard and scope. */
  @Post('qa/run')
  @HttpCode(200)
  async run(@CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(RunBody)) body: z.infer<typeof RunBody>) {
    try {
      return { sql: body.sql, ...(await this.qa.runner.run(org.id, body.sql)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException({ message: err instanceof SqlRejected ? `Not allowed: ${message}` : `The query did not run: ${message}`, code: err instanceof SqlRejected ? 'sql_rejected' : 'sql_failed' });
    }
  }

  @Get('regulations')
  regulationChanges(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser) {
    return this.regulations.changes(org.id, user.id);
  }

  @Get('regulations/unread')
  async regulationUnread(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser) {
    return { unread: await this.regulations.unread(org.id, user.id) };
  }

  @Post('regulations/read')
  @HttpCode(204)
  async regulationRead(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser) {
    if (!isDemo()) await this.regulations.markRead(org.id, user.id);
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
