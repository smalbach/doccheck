import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { DemoController } from '../demo/demo.controller';
import { DocumentProcessor } from './document.processor';
import { ShipmentOwnerGuard } from './shipment-owner.guard';
import { ExtractionQueue } from './extraction.queue';
import { ShipmentsRepository } from './shipments.repository';
import { ShipmentsService } from './shipments.service';

@Module({
  controllers: [ShipmentsController, DemoController],
  providers: [ShipmentsService, ShipmentsRepository, DocumentProcessor, ExtractionQueue, ShipmentOwnerGuard],
})
export class ShipmentsModule {}
