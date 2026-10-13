import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SetRoleDto, UpdateSettingsDto } from './admin.dto';
import { AdminService } from './admin.service';
import { SettingsService } from './settings.service';

/** Admin only (AdminGuard on every route, after the global AuthGuard). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly settings: SettingsService,
    private readonly admin: AdminService,
  ) {}

  @Get('settings')
  listSettings() {
    return this.settings.list();
  }

  /** Body: { llmModel?, agentEnabled?, ocrLanguages?, ocrScale?, ocrPsm? }. All are validated before any is saved. */
  @Put('settings')
  updateSettings(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(UpdateSettingsDto)) dto: UpdateSettingsDto) {
    return this.settings.update(dto, user.id);
  }

  /** Back to the .env value (or the default). */
  @Delete('settings/:key')
  resetSetting(@Param('key') key: string) {
    return this.settings.reset(key);
  }

  @Get('models')
  models() {
    return this.admin.models();
  }

  @Get('system')
  system() {
    return this.admin.system();
  }

  @Get('users')
  users() {
    return this.admin.users();
  }

  @Patch('users/:id')
  setRole(@CurrentUser() user: PublicUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(SetRoleDto)) dto: SetRoleDto) {
    return this.admin.setRole(user.id, id, dto.role);
  }
}
