import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ImapPoller } from './imap.poller';
import { MailController } from './mail.controller';
import { MailIntakeService } from './mail-intake.service';
import { MailSettingsController } from './mail-settings.controller';
import { MailSettingsService } from './mail-settings.service';
import { MailInbox } from './mail-inbox';
import { MailRepository } from './mail.repository';
import { MailService } from './mail.service';
import { MailTransport } from './mail-transport';
import { OutboxWorker } from './outbox.worker';
import { PlusCheckService } from './plus-check.service';
import { PortalController, SupplierPortalController } from '../portal/portal.controller';
import { PortalGuard } from '../portal/portal.guard';
import { PortalRepository } from '../portal/portal.repository';
import { PortalService } from '../portal/portal.service';
import { PortalThrottle } from '../portal/portal-throttle';

@Module({
  imports: [ShipmentsModule],
  controllers: [MailController, MailSettingsController, PortalController, SupplierPortalController],
  providers: [MailService, MailRepository, MailInbox, MailTransport, OutboxWorker, ImapPoller, MailSettingsService, MailIntakeService, PlusCheckService, PortalService, PortalRepository, PortalThrottle, PortalGuard],
})
export class MailModule {}
