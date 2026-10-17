import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

@Module({
  controllers: [AdminController, AiProvidersController],
  providers: [AdminService, AdminRepository, SettingsService, SettingsRepository, AiProvidersService],
})
export class AdminModule {}
