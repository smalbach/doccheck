import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { LlmModule } from './llm/llm.module';
import { ResultsController } from './results/results.controller';
import { HealthController } from './health/health.controller';
import { RulesController } from './rules/rules.controller';
import { ShipmentsModule } from './shipments/shipments.module';
import { StorageModule } from './storage/storage';

@Module({
  imports: [DbModule, StorageModule, LlmModule, AuthModule, ShipmentsModule],
  controllers: [HealthController, RulesController, ResultsController],
})
export class AppModule {}
