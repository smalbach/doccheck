import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MailServerDto, MailTestDto } from './mail-settings.dto';
import { MailSettingsService } from './mail-settings.service';

/** The mail server, set from the admin settings page (passwords are never sent back). */
@Controller('admin/mail')
@UseGuards(AdminGuard)
export class MailSettingsController {
  constructor(private readonly settings: MailSettingsService) {}

  @Get()
  get() {
    return this.settings.view();
  }

  @Put()
  save(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(MailServerDto)) dto: MailServerDto) {
    return this.settings.save(dto, user.id);
  }

  /** Back to .env. */
  @Delete()
  reset() {
    return this.settings.reset();
  }

  /** Logs in to the SMTP server and sends a test email to the admin, or opens the IMAP mailbox. */
  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(MailTestDto)) dto: MailTestDto) {
    return this.settings.test(dto.kind, dto.config, user.email);
  }
}
