import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SetPlanDto, UpdatePlanDto } from './usage.dto';
import { UsageService } from './usage.service';

@Controller()
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** This month's usage of the signed-in account: plan, a meter per kind (ok, warning, over, blocked), past months. */
  @Get('usage')
  mine(@CurrentUser() user: PublicUser) {
    return this.usage.usage(user.id);
  }

  @Get('usage/plans')
  plans() {
    return this.usage.plans();
  }

  /** Body: { name, extractionsPerMonth, validationsPerMonth (null: unlimited), warnPercent, enforcement: soft | hard }. */
  @Put('admin/plans/:id')
  @UseGuards(AdminGuard)
  updatePlan(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body(new ZodValidationPipe(UpdatePlanDto)) dto: UpdatePlanDto) {
    return this.usage.updatePlan(id, dto, user.id);
  }

  /** Every account's usage this month with its plan. */
  @Get('admin/usage')
  @UseGuards(AdminGuard)
  accounts() {
    return this.usage.accounts();
  }

  /** Puts an account on a plan by hand (without billing, or to override it). */
  @Put('admin/usage/:userId/plan')
  @UseGuards(AdminGuard)
  setPlan(@Param('userId', new ParseUUIDPipe()) userId: string, @Body(new ZodValidationPipe(SetPlanDto)) dto: SetPlanDto) {
    return this.usage.setPlan(userId, dto.plan);
  }
}
