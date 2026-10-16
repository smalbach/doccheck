import { Module } from '@nestjs/common';
import { ScreeningAdminController, ScreeningController } from './screening.controller';
import { ScreeningRepository } from './screening.repository';
import { ScreeningService } from './screening.service';

@Module({
  controllers: [ScreeningController, ScreeningAdminController],
  providers: [ScreeningService, ScreeningRepository],
  exports: [ScreeningService],
})
export class ScreeningModule {}
