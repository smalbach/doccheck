import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CollabModule } from './collab/collab.module';
import { NotificationsModule } from './collab/notifications.module';
import { DbModule } from './db/db.module';
import { DutiesModule } from './duties/duties.module';
import { InsightsModule } from './insights/insights.module';
import { LlmModule } from './llm/llm.module';
import { MailModule } from './messaging/mail.module';
import { ProgressModule } from './progress/progress.module';
import { ResultsController } from './results/results.controller';
import { HealthController } from './health/health.controller';
import { RulesController } from './rules/rules.controller';
import { OrgsModule } from './orgs/orgs.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { StorageModule } from './storage/storage';

@Module({
  imports: [
    DbModule, StorageModule, LlmModule, ProgressModule, AuditModule, NotificationsModule, AuthModule, ShipmentsModule, AdminModule, InsightsModule, MailModule,
    OrgsModule, CollabModule, DutiesModule,
  ],
  controllers: [HealthController, RulesController, ResultsController],
})
export class AppModule {}
