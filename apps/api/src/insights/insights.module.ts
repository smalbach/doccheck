import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { InsightsRepository } from './insights.repository';

@Module({
  controllers: [InsightsController],
  providers: [InsightsRepository],
})
export class InsightsModule {}
