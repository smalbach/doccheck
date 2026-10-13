import { Module } from '@nestjs/common';
import { ShipmentsModule } from '../shipments/shipments.module';
import { ImapPoller } from './imap.poller';
import { MailController } from './mail.controller';
import { MailInbox } from './mail-inbox';
import { MailRepository } from './mail.repository';
import { MailService } from './mail.service';
import { MailTransport } from './mail-transport';
import { OutboxWorker } from './outbox.worker';

@Module({
  imports: [ShipmentsModule],
  controllers: [MailController],
  providers: [MailService, MailRepository, MailInbox, MailTransport, OutboxWorker, ImapPoller],
})
export class MailModule {}
