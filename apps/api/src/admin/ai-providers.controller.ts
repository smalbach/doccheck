import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NoOrg } from '../orgs/permissions';
import { AiProvidersDto, AiReindexDto, AiTestDto } from './ai-providers.dto';
import { AiProvidersService } from './ai-providers.service';

/** Model, embedding and OCR services, set from the admin settings page (keys are never sent back). */
@NoOrg()
@Controller('admin/ai')
@UseGuards(AdminGuard)
export class AiProvidersController {
  constructor(private readonly ai: AiProvidersService) {}

  @Get()
  get() {
    return this.ai.view();
  }

  @Put()
  save(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(AiProvidersDto)) dto: AiProvidersDto) {
    return this.ai.save(dto, user.id);
  }

  /** Back to .env. */
  @Delete()
  reset() {
    return this.ai.reset();
  }

  /** Calls the model, the embedding model or a cloud OCR service once with a test input. */
  @Post('test')
  @HttpCode(200)
  test(@Body(new ZodValidationPipe(AiTestDto)) dto: AiTestDto) {
    return this.ai.test(dto.target, dto.config);
  }

  /** Body { scope?: all | regulations | tariff }: rebuilds the indexes with the current embedding model, in the background. */
  @Post('reindex')
  @HttpCode(202)
  reindex(@Body(new ZodValidationPipe(AiReindexDto)) dto: AiReindexDto) {
    return this.ai.reindex(dto.scope);
  }
}
