import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, Injectable, Logger, NotFoundException, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors,
  type CanActivate, type ExecutionContext, UseFilters,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { ExportFormat } from '@doccheck/integrations';
import type { ShipmentDocument } from '@doccheck/schemas';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Public } from '../../auth/public.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ShipmentsRepository } from '../../shipments/shipments.repository';
import { ShipmentsService } from '../../shipments/shipments.service';
import type { ApiPrincipal, ApiRequest } from '../account';
import { ApiKeyGuard } from '../api-key.guard';
import { Permission } from '../../orgs/permissions';
import { OrgsRepository } from '../../orgs/orgs.repository';
import type { OrgRequest } from '../../orgs/org.types';
import { ExportsService } from '../exports.service';
import { UsageService } from '../../usage/usage.service';
import { V1ErrorsFilter } from './v1-errors.filter';
import { IdempotencyStore, requestHash, type IdempotentResult } from '../idempotency';
import {
  CreateShipmentRequest, ExportFormatParam, ListShipmentsQuery, SendExportRequest, toV1Document, toV1Finding, toV1Shipment, ValidateQuery,
} from './v1.schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const principalOf = (req: ApiRequest) => req.principal as ApiPrincipal;

/** Routes with a shipment :id answer 404 unless the shipment belongs to the key's organization (as for one that does not exist). */
@Injectable()
export class ApiShipmentGuard implements CanActivate {
  constructor(private readonly orgs: OrgsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & ApiRequest & OrgRequest>();
    const id = req.params.id;
    if (typeof id !== 'string') return true;
    // The same check as ShipmentOwnerGuard, in the key's organization (a key never acts as a client).
    if (!req.principal || !req.org || !UUID.test(id) || !(await this.orgs.canSeeShipment(id, req.org, req.principal.actingUserId ?? ''))) throw new NotFoundException(`Shipment ${id} not found`);
    return true;
  }
}

function reply<T>(res: Response, result: IdempotentResult<T>): T {
  res.status(result.status);
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  return result.body;
}

/**
 * Public REST API v1, authenticated with API keys (docs/INTEGRATIONS.md; OpenAPI at /api/v1/openapi.json).
 * Session cookies do not work here, and API keys do not work on the app's own routes.
 */
@Controller('api/v1')
@Public()
@UseGuards(ApiKeyGuard, ApiShipmentGuard)
@UseFilters(V1ErrorsFilter)
export class V1Controller {
  private readonly logger = new Logger(V1Controller.name);

  constructor(
    private readonly shipments: ShipmentsService,
    private readonly repo: ShipmentsRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly exports: ExportsService,
    private readonly usage: UsageService,
  ) {}

  @Get('shipments')
  @Permission('data.read')
  async list(@Req() req: ApiRequest, @Query(new ZodValidationPipe(ListShipmentsQuery)) query: ListShipmentsQuery) {
    const page = await this.shipments.list({ orgId: principalOf(req).orgId }, query);
    return { items: page.items, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Post('shipments')
  @Permission('shipment.write')
  async create(@Req() req: ApiRequest & Request, @Res({ passthrough: true }) res: Response, @Headers('idempotency-key') key: string | undefined, @Body(new ZodValidationPipe(CreateShipmentRequest)) dto: CreateShipmentRequest) {
    const p = principalOf(req);
    const result = await this.idempotency.run(p.keyId, key, requestHash('POST', req.path, JSON.stringify(dto)), 201, async () => toV1Shipment(await this.shipments.create(dto, p.actingUserId as string, p.orgId)));
    return reply(res, result);
  }

  @Get('shipments/:id')
  @Permission('shipment.read')
  async get(@Param('id') id: string) {
    return toV1Shipment(await this.shipments.get(id));
  }

  /** Multipart, field "files": up to 10 PDFs of 20 MB. 202: queued for extraction. */
  @Post('shipments/:id/documents')
  @Permission('shipment.write')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_PDF_BYTES } }))
  async upload(@Req() req: ApiRequest & Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Headers('idempotency-key') key: string | undefined, @UploadedFiles() files: Express.Multer.File[] = []) {
    if (files.length === 0) throw new BadRequestException('Send at least one PDF in the "files" field');
    const p = principalOf(req);
    const hash = requestHash('POST', req.path, ...files.flatMap((f) => [f.originalname, createHash('sha256').update(f.buffer).digest('hex')]));
    const result = await this.idempotency.run(p.keyId, key, hash, 202, async () => {
      const { documents } = await this.shipments.addDocuments(id, files.map((f) => ({ name: f.originalname, bytes: f.buffer })));
      return { documents: (documents as ShipmentDocument[]).map(toV1Document) };
    });
    return reply(res, result);
  }

  @Get('shipments/:id/documents/:documentId')
  @Permission('shipment.read')
  async document(@Param('id') id: string, @Param('documentId') documentId: string) {
    const d = (await this.shipments.document(id, documentId)) as { document: Parameters<typeof toV1Document>[0]; documentType?: string; data?: unknown; issues?: string[]; corrected?: unknown[] };
    return {
      document: toV1Document(d.document),
      ...(d.documentType ? { documentType: d.documentType } : {}),
      ...('data' in d ? { data: d.data ?? null } : {}),
      ...(d.issues ? { issues: d.issues } : {}),
      ...(d.corrected ? { corrected: d.corrected } : {}),
    };
  }

  /**
   * Runs the rules (and, unless ?agent=false, the local model's review) on the extracted documents.
   * 202 at once (validation.completed follows), or with ?wait=true 200 with the validation.
   */
  @Post('shipments/:id/validate')
  @Permission('shipment.write')
  async validate(@Res({ passthrough: true }) res: Response, @Param('id') id: string, @Query(new ZodValidationPipe(ValidateQuery)) query: ValidateQuery) {
    const agent = query.agent === undefined ? undefined : query.agent === 'true';
    if (query.wait === 'true') {
      await this.shipments.validate(id, {}, { agent });
      res.status(200);
      return this.findings(id);
    }
    // The checks validate() makes before it starts, made here so they answer this request.
    const shipment = await this.shipments.get(id);
    if (!shipment.destination) throw new BadRequestException('Set the destination (CA or US) before validating');
    const pending = await this.repo.pendingDocuments(id);
    if (pending > 0) throw new ConflictException(`${pending} document(s) are still being extracted; validate when they are done`);
    // The plan's limit answers this request (402), not the background run.
    await this.usage.assertAllowed(id, 'validation');
    void this.shipments.validate(id, {}, { agent }).catch((err: Error) => this.logger.warn(`Validation of ${id} requested through the API failed: ${err.message}`));
    res.status(202);
    return { shipmentId: id, status: 'VALIDATING' as const };
  }

  /** The latest validation with its findings and the user's decisions; 404 before the first one. */
  @Get('shipments/:id/findings')
  @Permission('shipment.read')
  async findings(@Param('id') id: string) {
    const v = await this.shipments.latestValidation(id);
    return {
      id: v.id,
      createdAt: v.createdAt,
      ...(v.destination ? { destination: v.destination } : {}),
      ran: v.ran,
      skipped: v.skipped,
      findings: v.findings.map(toV1Finding),
      ...(v.resolved ? { resolved: v.resolved.map(toV1Finding) } : {}),
    };
  }

  /** The export as a file download. 409 before the shipment is validated, or when it lacks a document the format needs. */
  @Get('shipments/:id/exports/:format')
  @Permission('shipment.read')
  async export(@Param('id') id: string, @Param('format', new ZodValidationPipe(ExportFormatParam)) format: ExportFormat, @Res() res: Response) {
    const file = await this.exports.build(id, format);
    res.setHeader('content-type', `${file.contentType}; charset=utf-8`);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  }

  @Post('shipments/:id/exports/:format/send')
  @Permission('shipment.write')
  async send(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Param('format', new ZodValidationPipe(ExportFormatParam)) format: ExportFormat, @Body(new ZodValidationPipe(SendExportRequest)) dto: SendExportRequest) {
    res.status(200);
    return this.exports.send(id, principalOf(req).orgId, format, dto.connector);
  }
}

type CreateShipmentRequest = import('zod').infer<typeof CreateShipmentRequest>;
type ListShipmentsQuery = import('zod').infer<typeof ListShipmentsQuery>;
type ValidateQuery = import('zod').infer<typeof ValidateQuery>;
type SendExportRequest = import('zod').infer<typeof SendExportRequest>;
