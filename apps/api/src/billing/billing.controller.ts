import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CheckoutDto } from '../usage/usage.dto';
import { BillingService } from './billing.service';

/** Stripe in test mode, off unless its variables are set (docs/BILLING.md). */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** { enabled, plans }: whether the web shows upgrade buttons, and for which plans. */
  @Get()
  status() {
    return this.billing.status();
  }

  /** { plan } -> { url } of a Stripe Checkout page. */
  @Post('checkout')
  @HttpCode(200)
  checkout(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CheckoutDto)) dto: CheckoutDto) {
    return this.billing.checkout(user, dto.plan);
  }

  /** { url } of Stripe's customer portal for this account. */
  @Post('portal')
  @HttpCode(200)
  portal(@CurrentUser() user: PublicUser) {
    return this.billing.portal(user);
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
