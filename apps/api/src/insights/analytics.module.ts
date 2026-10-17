import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsRepository } from './analytics.repository';
import { PricesRepository } from './prices.repository';
import { QaService } from './qa/qa.service';
import { RegulationWatchService } from './regwatch/regwatch.service';

/** KPIs, supplier scorecard, cost avoided, price benchmark, Data Q&A and regulation changes (docs/ANALYTICS.md). */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository, PricesRepository, QaService, RegulationWatchService],
})
export class AnalyticsModule {}
