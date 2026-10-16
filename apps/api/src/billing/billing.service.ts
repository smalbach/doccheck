import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { appUrl } from '../auth/app-url';
import type { PublicUser } from '../auth/auth.types';
import { UsageRepository } from '../usage/usage.repository';
import { StripeApiError, stripeCall, stripeSetup, StripeSignatureError, verifyStripeSignature, type StripeConfig } from './stripe';

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

interface Subscription {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string } }[] };
}

/** Subscription states that keep the paid plan; anything else (canceled, unpaid…) goes back to free. */
const PAID_STATES = new Set(['active', 'trialing', 'past_due']);

/** Checkout, customer portal and the webhook that sets an account's plan. Test mode only (stripe.ts). */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly usage: UsageRepository) {
    const setup = stripeSetup();
    if (process.env.STRIPE_SECRET_KEY && !setup.enabled) this.logger.warn(`Billing is off: ${setup.reason}`);
  }

  status() {
    const setup = stripeSetup();
    return setup.enabled ? { enabled: true, plans: Object.keys(setup.config.prices) } : { enabled: false, plans: [] as string[] };
  }

  private config(): StripeConfig {
    const setup = stripeSetup();
    if (!setup.enabled) throw new ServiceUnavailableException(`Billing is not set up: ${setup.reason}`);
    return setup.config;
  }

  private returnUrl(query: string) {
    const base = appUrl();
    if (!base) throw new ServiceUnavailableException('APP_URL is not set, so Stripe cannot send the user back');
    return `${base}/#/app/usage${query}`;
  }

  private async customer(config: StripeConfig, user: PublicUser): Promise<string> {
    const account = await this.usage.account(user.id);
    if (!account) throw new NotFoundException('Account not found');
    if (account.stripeCustomerId) return account.stripeCustomerId;
    const created = await this.call<{ id: string }>(config, 'customers', { email: user.email, name: user.name, metadata: { user_id: user.id } });
    await this.usage.setStripeCustomer(user.id, created.id);
    return created.id;
  }

  /** A Stripe Checkout page for a paid plan; the webhook sets the plan once it is paid. */
  async checkout(user: PublicUser, plan: string): Promise<{ url: string }> {
    const config = this.config();
    const price = config.prices[plan];
    if (!price) throw new BadRequestException(`Plan ${plan} cannot be bought`);
    const customer = await this.customer(config, user);
    const session = await this.call<{ url: string }>(config, 'checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id, plan } },
      success_url: this.returnUrl('?checkout=done'),
      cancel_url: this.returnUrl('?checkout=cancelled'),
    });
    return { url: session.url };
  }

  /** Stripe's customer portal: change or cancel the subscription, invoices, card. */
  async portal(user: PublicUser): Promise<{ url: string }> {
    const config = this.config();
    const account = await this.usage.account(user.id);
    if (!account?.stripeCustomerId) throw new BadRequestException('This account has no subscription to manage');
    const session = await this.call<{ url: string }>(config, 'billing_portal/sessions', { customer: account.stripeCustomerId, return_url: this.returnUrl('') });
    return { url: session.url };
  }

  private async call<T>(config: StripeConfig, path: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await stripeCall<T>(config, path, params);
    } catch (err) {
      if (err instanceof StripeApiError) throw new BadGatewayException(err.message);
      throw err;
    }
  }

  /**
   * Applies a webhook event: checkout completed, subscription created, updated or deleted. Events are
   * applied once (Stripe retries), and a live-mode event is refused.
   */
  async webhook(body: Buffer, signature: string | undefined): Promise<{ received: true; applied: boolean }> {
    const config = this.config();
    try {
      verifyStripeSignature(body, signature, config.webhookSecret);
    } catch (err) {
      if (err instanceof StripeSignatureError) throw new BadRequestException(err.message);
      throw err;
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(body.toString('utf8')) as StripeEvent;
    } catch {
      throw new BadRequestException('The event is not JSON');
    }
    if (event.livemode) throw new BadRequestException('Live-mode events are refused: billing runs in test mode only');
    if (!event.id || !event.type) throw new BadRequestException('Not a Stripe event');
    if (!(await this.usage.claimEvent(event.id, event.type))) return { received: true, applied: false };
    try {
      const applied = await this.apply(event, config);
      return { received: true, applied };
    } catch (err) {
      // Not applied: let Stripe's retry try again.
      await this.usage.forgetEvent(event.id);
      throw err;
    }
  }

  private planOfPrice(config: StripeConfig, priceId: string | undefined): string | undefined {
    return Object.entries(config.prices).find(([, p]) => p === priceId)?.[0];
  }

  private async apply(event: StripeEvent, config: StripeConfig): Promise<boolean> {
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const userId = String(obj.client_reference_id ?? (obj.metadata as Record<string, string> | undefined)?.user_id ?? '');
      const plan = (obj.metadata as Record<string, string> | undefined)?.plan;
      if (!userId || !plan || !(plan in config.prices)) return false;
      if (typeof obj.customer === 'string') await this.usage.setStripeCustomer(userId, obj.customer);
      await this.usage.setSubscription(userId, plan, typeof obj.subscription === 'string' ? obj.subscription : null);
      this.logger.log(`Checkout completed: account ${userId} is now on ${plan}`);
      return true;
    }
    if (event.type.startsWith('customer.subscription.')) {
      const sub = obj as unknown as Subscription;
      const userId = (await this.usage.userByStripeCustomer(sub.customer)) ?? sub.metadata?.user_id;
      if (!userId) return false;
      const paid = event.type !== 'customer.subscription.deleted' && PAID_STATES.has(sub.status);
      const plan = paid ? (this.planOfPrice(config, sub.items?.data?.[0]?.price?.id) ?? sub.metadata?.plan) : 'free';
      if (!plan || (plan !== 'free' && !(plan in config.prices))) return false;
      await this.usage.setSubscription(userId, plan, paid ? sub.id : null);
      this.logger.log(`Subscription ${sub.status}: account ${userId} is now on ${plan}`);
      return true;
    }
    return false;
  }
}
