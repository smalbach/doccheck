import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminRepository, SettingsService, SettingsRepository],
})
export class AdminModule {}
