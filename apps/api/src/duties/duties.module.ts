import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { DutiesController } from './duties.controller';
import { DutiesRepository } from './duties.repository';
import { DutiesService } from './duties.service';

@Module({
  imports: [ShipmentsModule],
  controllers: [DutiesController],
  providers: [DutiesService, DutiesRepository],
})
export class DutiesModule {}
