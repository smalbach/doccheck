import { Global, Module } from '@nestjs/common';
import { BillingController } from '../billing/billing.controller';
import { BillingService } from '../billing/billing.service';
import { UsageController } from './usage.controller';
import { UsageRepository } from './usage.repository';
import { UsageService } from './usage.service';

/** Usage metering, plans and (test-mode) billing. Global: the shipments and review modules check and count usage. */
@Global()
@Module({
  controllers: [UsageController, BillingController],
  providers: [UsageRepository, UsageService, BillingService],
  exports: [UsageService],
})
export class UsageModule {}
