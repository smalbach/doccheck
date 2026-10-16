import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ApprovalsController, CollabController, NotificationsController } from './collab.controller';
import { CollabService } from './collab.service';

/** Assignments, comments, approvals and their notifications (docs/ORGANIZATIONS.md). */
@Module({
  imports: [ShipmentsModule],
  controllers: [CollabController, ApprovalsController, NotificationsController],
  providers: [CollabService],
})
export class CollabModule {}
