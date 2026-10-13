import { Global, Module } from '@nestjs/common';
import { ProgressEstimatesService } from './progress-estimates.service';
import { ProgressRepository } from './progress.repository';
import { ProgressService } from './progress.service';

/**
 * Live progress events (docs/PROGRESS-EVENTS.md). Global so the extraction worker and the validation
 * can publish; the SSE routes (ProgressController) are registered with the shipments, whose owner guard they use.
 */
@Global()
@Module({
  providers: [ProgressService, ProgressRepository, ProgressEstimatesService],
  exports: [ProgressService, ProgressRepository, ProgressEstimatesService],
})
export class ProgressModule {}
