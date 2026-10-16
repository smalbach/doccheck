import { Global, Module } from '@nestjs/common';
import { ReviewController } from './review.controller';
import { ReviewRepository } from './review.repository';
import { ReviewService } from './review.service';

/** Review queue and supplier learning. Global: extraction and corrections report to it. */
@Global()
@Module({
  controllers: [ReviewController],
  providers: [ReviewRepository, ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
