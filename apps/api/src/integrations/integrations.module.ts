import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService } from './api-keys';
import { DeliveryWorker } from './deliveries';
import { IntegrationEventsService } from './events.service';
import { ExportsService } from './exports.service';
import { IdempotencyStore } from './idempotency';
import { IngestionService } from './ingestion.service';
import { IntegrationsController, ShipmentIntegrationsController } from './integrations.controller';
import { RateLimiter } from './rate-limiter';
import { TargetsService } from './targets.service';
import { TrackingService } from './tracking.service';
import { OpenApiController } from './v1/openapi.controller';
import { ApiShipmentGuard, V1Controller } from './v1/v1.controller';

/** Public REST API v1, API keys, webhooks, chat alerts, folder ingestion, exports and container tracking (docs/INTEGRATIONS.md). */
@Module({
  imports: [ShipmentsModule],
  controllers: [V1Controller, OpenApiController, IntegrationsController, ShipmentIntegrationsController],
  providers: [
    ApiKeysService, ApiKeyGuard, ApiShipmentGuard, RateLimiter, IdempotencyStore, DeliveryWorker, IntegrationEventsService, TargetsService, TrackingService, IngestionService, ExportsService, ShipmentOwnerGuard,
  ],
})
export class IntegrationsModule {}
