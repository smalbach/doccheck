import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import { EVENT_TYPES, type ExportFormat } from '@doccheck/integrations';
import type { Response } from 'express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { accountOf } from './account';
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
 * ingestion, container tracking, and export downloads. Everything is scoped to the account.
 */
@Controller('integrations')
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
  listKeys(@CurrentUser() user: PublicUser) {
    return this.keys.list(accountOf(user));
  }

  @Post('api-keys')
  createKey(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateApiKeyDto)) dto: CreateApiKeyDto) {
    return this.keys.create(accountOf(user), user.id, dto);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  revokeKey(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.keys.revoke(accountOf(user), id);
  }

  // Webhooks

  @Get('webhooks')
  listWebhooks(@CurrentUser() user: PublicUser) {
    return this.targets.listWebhooks(accountOf(user));
  }

  @Post('webhooks')
  createWebhook(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateWebhookDto)) dto: CreateWebhookDto) {
    return this.targets.createWebhook(accountOf(user), dto);
  }

  @Patch('webhooks/:id')
  updateWebhook(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(UpdateWebhookDto)) dto: UpdateWebhookDto) {
    return this.targets.updateWebhook(accountOf(user), id, dto);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  async deleteWebhook(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    await this.targets.remove(accountOf(user), 'webhook', id);
  }

  @Post('webhooks/:id/secret')
  @HttpCode(200)
  webhookSecret(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.secret(accountOf(user), id);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  rotateSecret(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.rotateSecret(accountOf(user), id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  testWebhook(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.test(accountOf(user), 'webhook', id);
  }

  @Get('webhooks/:id/deliveries')
  webhookDeliveries(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.deliveriesOf(accountOf(user), id);
  }

  // Chat alerts

  @Get('chat-alerts')
  listChat(@CurrentUser() user: PublicUser) {
    return this.targets.listChatAlerts(accountOf(user));
  }

  @Post('chat-alerts')
  createChat(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateChatAlertDto)) dto: CreateChatAlertDto) {
    return this.targets.createChatAlert(accountOf(user), dto);
  }

  @Patch('chat-alerts/:id')
  updateChat(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(UpdateChatAlertDto)) dto: UpdateChatAlertDto) {
    return this.targets.updateChatAlert(accountOf(user), id, dto);
  }

  @Delete('chat-alerts/:id')
  @HttpCode(204)
  async deleteChat(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    await this.targets.remove(accountOf(user), 'chat', id);
  }

  @Post('chat-alerts/:id/test')
  @HttpCode(200)
  testChat(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.test(accountOf(user), 'chat', id);
  }

  @Get('chat-alerts/:id/deliveries')
  chatDeliveries(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.deliveriesOf(accountOf(user), id);
  }

  // Delivery log

  @Get('deliveries/:id')
  delivery(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.delivery(accountOf(user), id);
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(200)
  redeliver(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.targets.redeliver(accountOf(user), id);
  }

  // Folder ingestion

  @Get('ingestion')
  listSources(@CurrentUser() user: PublicUser) {
    return this.ingestion.list(accountOf(user));
  }

  @Post('ingestion')
  createSource(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(SourceDto)) dto: SourceDto) {
    return this.ingestion.create(accountOf(user), dto);
  }

  /** Lists the source with the settings in the body (the saved secret when none is typed and `id` is set). */
  @Post('ingestion/test')
  @HttpCode(200)
  testSource(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(TestSourceDto)) dto: TestSourceDto) {
    return this.ingestion.test(accountOf(user), dto);
  }

  @Put('ingestion/:id')
  updateSource(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(SourceDto)) dto: SourceDto) {
    return this.ingestion.update(accountOf(user), id, dto);
  }

  @Delete('ingestion/:id')
  @HttpCode(204)
  async deleteSource(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    await this.ingestion.remove(accountOf(user), id);
  }

  @Post('ingestion/:id/poll')
  @HttpCode(200)
  pollSource(@CurrentUser() user: PublicUser, @Param('id', uuid) id: string) {
    return this.ingestion.pollNow(accountOf(user), id);
  }

  // Container tracking

  @Get('tracking')
  trackingSettings(@CurrentUser() user: PublicUser) {
    return this.tracking.settings(accountOf(user));
  }

  @Put('tracking')
  saveTracking(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(TrackingDto)) dto: TrackingDto) {
    return this.tracking.save(accountOf(user), dto);
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
  async export(@Param('id') id: string, @Param('format', new ZodValidationPipe(ExportFormatParam)) format: ExportFormat, @Res() res: Response) {
    const file = await this.exports.build(id, format);
    res.setHeader('content-type', `${file.contentType}; charset=utf-8`);
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  }

  @Get(':id/tracking')
  async trackingEvents(@Param('id') id: string) {
    return (await this.tracking.latest(id)) ?? { events: [] };
  }
}
