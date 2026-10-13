import { Module } from '@nestjs/common';
import { EntitiesRepository } from './entities.repository';
import { InsightsController } from './insights.controller';
import { InsightsRepository } from './insights.repository';

@Module({
  controllers: [InsightsController],
  providers: [InsightsRepository, EntitiesRepository],
})
export class InsightsModule {}
