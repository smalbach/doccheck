import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { DutyInputs } from '@doccheck/duties';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { DutiesService } from './duties.service';

/**
 * Duty, taxes and landed cost per shipment, and the draft entry summary. Limited to shipments of the
 * active organization (ShipmentOwnerGuard: 404 otherwise); reading follows the shipment, saving the
 * answers needs shipment.write. The rate tables are global and edited by the server administrator.
 */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class DutiesController {
  constructor(private readonly duties: DutiesService) {}

  /** → { estimate, entry?, inputsUpdatedAt? } with the answers saved for the shipment. */
  @Get(':id/duties')
  @Permission('shipment.read')
  get(@Param('id') id: string, @CurrentOrg() org: OrgContext) {
    return this.duties.view(id, org.id);
  }

  /** Saves the answers (DutyInputs, replacing the previous ones) and returns the new estimate. */
  @Put(':id/duties/inputs')
  @Permission('shipment.write')
  save(@Param('id') id: string, @CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(DutyInputs)) inputs: DutyInputs) {
    return this.duties.saveInputs(id, org.id, inputs, user.id);
  }

  /** The estimate with these answers, without saving them (the read-only demo uses it). Nothing is written. */
  @Post(':id/duties/preview')
  @HttpCode(200)
  @Permission('shipment.read')
  preview(@Param('id') id: string, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(DutyInputs)) inputs: DutyInputs) {
    return this.duties.view(id, org.id, inputs);
  }
}
