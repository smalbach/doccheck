import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { DutyInputs } from '@doccheck/duties';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { DutiesService } from './duties.service';

/** Duty, taxes and landed cost per shipment, and the draft entry summary. Limited to the owner's shipments. */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class DutiesController {
  constructor(private readonly duties: DutiesService) {}

  /** → { estimate, entry?, inputsUpdatedAt? } with the answers saved for the shipment. */
  @Get(':id/duties')
  get(@Param('id') id: string) {
    return this.duties.view(id);
  }

  /** Saves the answers (DutyInputs, replacing the previous ones) and returns the new estimate. */
  @Put(':id/duties/inputs')
  save(@Param('id') id: string, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(DutyInputs)) inputs: DutyInputs) {
    return this.duties.saveInputs(id, inputs, user.id);
  }

  /** The estimate with these answers, without saving them (the read-only demo uses it). */
  @Post(':id/duties/preview')
  preview(@Param('id') id: string, @Body(new ZodValidationPipe(DutyInputs)) inputs: DutyInputs) {
    return this.duties.view(id, inputs);
  }
}
