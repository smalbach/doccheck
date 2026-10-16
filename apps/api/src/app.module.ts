import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { InsightsModule } from './insights/insights.module';
import { LlmModule } from './llm/llm.module';
import { MailModule } from './messaging/mail.module';
import { ProgressModule } from './progress/progress.module';
import { ResultsController } from './results/results.controller';
import { HealthController } from './health/health.controller';
import { RulesController } from './rules/rules.controller';
import { RulesModule } from './rules/rules.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { StorageModule } from './storage/storage';

@Module({
  imports: [DbModule, StorageModule, LlmModule, ProgressModule, AuthModule, ShipmentsModule, AdminModule, InsightsModule, MailModule, RulesModule],
  controllers: [HealthController, RulesController, ResultsController],
})
export class AppModule {}
