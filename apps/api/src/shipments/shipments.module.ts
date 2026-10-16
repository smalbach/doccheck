import { Module } from '@nestjs/common';
import { ScreeningModule } from '../screening/screening.module';
import { AlertsRepository } from './alerts.repository';
import { ShipmentsController } from './shipments.controller';
import { DemoController } from '../demo/demo.controller';
import { ProgressController } from '../progress/progress.controller';
import { DocumentProcessor } from './document.processor';
import { ShipmentOwnerGuard } from './shipment-owner.guard';
import { ExtractionQueue } from './extraction.queue';
import { ShipmentsRepository } from './shipments.repository';
import { FindingReviewsRepository } from './reviews.repository';
import { ShipmentsService } from './shipments.service';

@Module({
  imports: [ScreeningModule],
  controllers: [ShipmentsController, DemoController, ProgressController],
  providers: [ShipmentsService, AlertsRepository, FindingReviewsRepository, ShipmentsRepository, DocumentProcessor, ExtractionQueue, ShipmentOwnerGuard],
  exports: [ShipmentsService, ShipmentsRepository, FindingReviewsRepository],
})
export class ShipmentsModule {}
