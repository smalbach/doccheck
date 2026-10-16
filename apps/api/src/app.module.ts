import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AnalyticsModule } from './insights/analytics.module';
import { CollabModule } from './collab/collab.module';
import { NotificationsModule } from './collab/notifications.module';
import { DbModule } from './db/db.module';
import { InsightsModule } from './insights/insights.module';
import { LlmModule } from './llm/llm.module';
import { MailModule } from './messaging/mail.module';
import { ProgressModule } from './progress/progress.module';
import { ResultsController } from './results/results.controller';
import { ReviewModule } from './review/review.module';
import { HealthController } from './health/health.controller';
import { RulesController } from './rules/rules.controller';
import { OrgsModule } from './orgs/orgs.module';
import { RulesModule } from './rules/rules.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { StorageModule } from './storage/storage';
import { UsageModule } from './usage/usage.module';

@Module({
  imports: [
    DbModule, StorageModule, LlmModule, ProgressModule, AuditModule, NotificationsModule, AuthModule, ShipmentsModule, AdminModule, InsightsModule, MailModule,
    OrgsModule, CollabModule, RulesModule, UsageModule, ReviewModule, AnalyticsModule,
  ],
  controllers: [HealthController, RulesController, ResultsController],
})
export class AppModule {}
