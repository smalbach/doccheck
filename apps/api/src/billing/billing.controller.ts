import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CheckoutDto } from '../usage/usage.dto';
import { BillingService } from './billing.service';

/** Stripe in test mode, off unless its variables are set (docs/BILLING.md). */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** { enabled, plans }: whether the web shows upgrade buttons, and for which plans. */
  @Get()
  @Permission('data.read')
  status() {
    return this.billing.status();
  }

  /** { plan } -> { url } of a Stripe Checkout page. */
  @Post('checkout')
  @HttpCode(200)
  @Permission('billing.manage')
  checkout(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CheckoutDto)) dto: CheckoutDto) {
    return this.billing.checkout(org, user, dto.plan);
  }

  /** { url } of Stripe's customer portal for the active organization. */
  @Post('portal')
  @HttpCode(200)
  @Permission('billing.manage')
  portal(@CurrentOrg() org: OrgContext) {
    return this.billing.portal(org);
  }

  /** Stripe's webhook. The raw body is kept (main.ts) so its signature can be checked. */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: Request, @Headers('stripe-signature') signature?: string) {
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Expected the raw event body');
    return this.billing.webhook(req.body, signature);
  }
}
