import { Global, Module } from '@nestjs/common';
import { RuleSettingsController } from './rule-settings.controller';
import { RuleSettingsRepository } from './rule-settings.repository';
import { RuleSettingsService } from './rule-settings.service';

/** Rule settings per account and purchase orders; global so validation can read them. */
@Global()
@Module({
  controllers: [RuleSettingsController],
  providers: [RuleSettingsRepository, RuleSettingsService],
  exports: [RuleSettingsService],
})
export class RulesModule {}
