import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import { EVENT_TYPES, type ExportFormat } from '@doccheck/integrations';
import type { Response } from 'express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import type { OrgContext } from '../orgs/org.types';
import { CurrentOrg } from '../orgs/current-org.decorator';
import { Permission } from '../orgs/permissions';
import { ApiKeysService } from './api-keys';
import { DeliveryWorker } from './deliveries';
import { ExportsService } from './exports.service';
import { IngestionService } from './ingestion.service';
import { localRoot } from './ingestion-sources';
import {
  CreateApiKeyDto, CreateChatAlertDto, CreateWebhookDto, SourceDto, TestSourceDto, TrackingDto, UpdateChatAlertDto, UpdateWebhookDto,
} from './integrations.dto';
import { TargetsService } from './targets.service';
import { TrackingService } from './tracking.service';
import { ExportFormatParam } from './v1/v1.schemas';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * The Integrations page of the app (signed-in session): API keys, webhooks, chat alerts, folder
 * ingestion, container tracking. Everything belongs to the active organization, and managing it needs
 * integrations.manage (owners and admins).
 */
@Controller('integrations')
@Permission('integrations.manage')
export class IntegrationsController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly targets: TargetsService,
    private readonly ingestion: IngestionService,
    private readonly tracking: TrackingService,
    private readonly exports: ExportsService,
    private readonly deliveries: DeliveryWorker,
  ) {}

  /** What the page needs to draw its forms. */
  @Get()
  overview() {
    return {
      events: EVENT_TYPES,
      connectors: this.exports.connectors.list(),
      deliveryMode: this.deliveries.mode,
      localRoot: localRoot(),
      openapi: '/api/v1/openapi.json',
    };
  }

  // API keys

  @Get('api-keys')
  listKeys(@CurrentOrg() org: OrgContext) {
    return this.keys.list(org.id);
  }

  @Post('api-keys')
  createKey(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateApiKeyDto)) dto: CreateApiKeyDto) {
    return this.keys.create(org.id, user.id, dto);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  revokeKey(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.keys.revoke(org.id, id);
  }

  // Webhooks

  @Get('webhooks')
  listWebhooks(@CurrentOrg() org: OrgContext) {
    return this.targets.listWebhooks(org.id);
  }

  @Post('webhooks')
  createWebhook(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateWebhookDto)) dto: CreateWebhookDto) {
    return this.targets.createWebhook(org.id, user.id, dto);
  }

  @Patch('webhooks/:id')
  updateWebhook(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(UpdateWebhookDto)) dto: UpdateWebhookDto) {
    return this.targets.updateWebhook(org.id, id, dto);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  async deleteWebhook(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    await this.targets.remove(org.id, 'webhook', id);
  }

  @Post('webhooks/:id/secret')
  @HttpCode(200)
  webhookSecret(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.secret(org.id, id);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  rotateSecret(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.rotateSecret(org.id, id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  testWebhook(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.test(org.id, 'webhook', id);
  }

  @Get('webhooks/:id/deliveries')
  webhookDeliveries(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.deliveriesOf(org.id, id);
  }

  // Chat alerts

  @Get('chat-alerts')
  listChat(@CurrentOrg() org: OrgContext) {
    return this.targets.listChatAlerts(org.id);
  }

  @Post('chat-alerts')
  createChat(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateChatAlertDto)) dto: CreateChatAlertDto) {
    return this.targets.createChatAlert(org.id, user.id, dto);
  }

  @Patch('chat-alerts/:id')
  updateChat(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(UpdateChatAlertDto)) dto: UpdateChatAlertDto) {
    return this.targets.updateChatAlert(org.id, id, dto);
  }

  @Delete('chat-alerts/:id')
  @HttpCode(204)
  async deleteChat(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    await this.targets.remove(org.id, 'chat', id);
  }

  @Post('chat-alerts/:id/test')
  @HttpCode(200)
  testChat(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.test(org.id, 'chat', id);
  }

  @Get('chat-alerts/:id/deliveries')
  chatDeliveries(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.deliveriesOf(org.id, id);
  }

  // Delivery log

  @Get('deliveries/:id')
  delivery(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.delivery(org.id, id);
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(200)
  redeliver(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.targets.redeliver(org.id, id);
  }

  // Folder ingestion

  @Get('ingestion')
  listSources(@CurrentOrg() org: OrgContext) {
    return this.ingestion.list(org.id);
  }

  @Post('ingestion')
  createSource(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(SourceDto)) dto: SourceDto) {
    return this.ingestion.create(org.id, user.id, dto);
  }

  /** Lists the source with the settings in the body (the saved secret when none is typed and `id` is set). */
  @Post('ingestion/test')
  @HttpCode(200)
  testSource(@CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(TestSourceDto)) dto: TestSourceDto) {
    return this.ingestion.test(org.id, dto);
  }

  @Put('ingestion/:id')
  updateSource(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(SourceDto)) dto: SourceDto) {
    return this.ingestion.update(org.id, id, dto);
  }

  @Delete('ingestion/:id')
  @HttpCode(204)
  async deleteSource(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    await this.ingestion.remove(org.id, id);
  }

  @Post('ingestion/:id/poll')
  @HttpCode(200)
  pollSource(@CurrentOrg() org: OrgContext, @Param('id', uuid) id: string) {
    return this.ingestion.pollNow(org.id, id);
  }

  // Container tracking

  @Get('tracking')
  trackingSettings(@CurrentOrg() org: OrgContext) {
    return this.tracking.settings(org.id);
  }

  @Put('tracking')
  saveTracking(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(TrackingDto)) dto: TrackingDto) {
    return this.tracking.save(org.id, user.id, dto);
  }
}

/** Shipment-level integration routes of the app: export downloads and the container events tracking compared. */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class ShipmentIntegrationsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly tracking: TrackingService,
  ) {}

  @Get(':id/exports/:format')
  @Permission('shipment.read')
  async export(@Param('id') id: string, @Param('format', new ZodValidationPipe(ExportFormatParam)) format: ExportFormat, @Res() res: Response) {
    const file = await this.exports.build(id, format);
    res.setHeader('content-type', `${file.contentType}; charset=utf-8`);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  }

  @Get(':id/tracking')
  @Permission('shipment.read')
  async trackingEvents(@Param('id') id: string) {
    return (await this.tracking.latest(id)) ?? { events: [] };
  }
}
