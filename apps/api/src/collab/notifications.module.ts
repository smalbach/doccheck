import { Global, Module } from '@nestjs/common';
import { Mailer } from '../mail/mailer';
import { NotificationsService } from './notifications.service';

/** Global: shipments (approval requests), collaboration and organizations notify members. */
@Global()
@Module({
  providers: [NotificationsService, Mailer],
  exports: [NotificationsService],
})
export class NotificationsModule {}
