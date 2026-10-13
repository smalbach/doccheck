import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { LlmModule } from './llm/llm.module';
import { HealthController } from './health/health.controller';
import { RulesController } from './rules/rules.controller';
import { ShipmentsModule } from './shipments/shipments.module';
import { StorageModule } from './storage/storage';

@Module({
  imports: [DbModule, StorageModule, LlmModule, ShipmentsModule],
  controllers: [HealthController, RulesController],
})
export class AppModule {}
