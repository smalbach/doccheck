import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { NoOrg, Permission } from '../orgs/permissions';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SetPlanDto, UpdatePlanDto } from './usage.dto';
import { UsageService } from './usage.service';

@Controller()
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** This month's usage of the active organization: plan, a meter per kind (ok, warning, over, blocked), past months. */
  @Get('usage')
  @Permission('data.read')
  mine(@CurrentOrg() org: OrgContext) {
    return this.usage.usage(org.id);
  }

  @Get('usage/plans')
  @Permission('data.read')
  plans() {
    return this.usage.plans();
  }

  /** Body: { name, extractionsPerMonth, validationsPerMonth (null: unlimited), warnPercent, enforcement: soft | hard }. */
  @Put('admin/plans/:id')
  @NoOrg()
  @UseGuards(AdminGuard)
  updatePlan(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body(new ZodValidationPipe(UpdatePlanDto)) dto: UpdatePlanDto) {
    return this.usage.updatePlan(id, dto, user.id);
  }

  /** Every organization's usage this month with its plan. */
  @Get('admin/usage')
  @NoOrg()
  @UseGuards(AdminGuard)
  orgs() {
    return this.usage.orgs();
  }

  /** Puts an organization on a plan by hand (without billing, or to override it). */
  @Put('admin/usage/:orgId/plan')
  @NoOrg()
  @UseGuards(AdminGuard)
  setPlan(@Param('orgId', new ParseUUIDPipe()) orgId: string, @Body(new ZodValidationPipe(SetPlanDto)) dto: SetPlanDto) {
    return this.usage.setPlan(orgId, dto.plan);
  }
}
