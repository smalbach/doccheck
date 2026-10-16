import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { appUrl } from '../auth/app-url';
import { AuditService } from '../audit/audit.service';
import type { PublicUser } from '../auth/auth.types';
import type { OrgContext } from '../orgs/org.types';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Subscription states that keep the paid plan; anything else (canceled, unpaid…) goes back to free. */
const PAID_STATES = new Set(['active', 'trialing', 'past_due']);

/**
 * Checkout, customer portal and the webhook that sets an organization's plan. Test mode only (stripe.ts).
 * The Stripe customer is the organization; its owners and admins buy and manage the plan.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly usage: UsageRepository,
    private readonly audit: AuditService,
  ) {
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

  /** The organization's Stripe customer, made the first time with the buyer's email for receipts. */
  private async customer(config: StripeConfig, org: OrgContext, user: PublicUser): Promise<string> {
    const account = await this.usage.org(org.id);
    if (!account) throw new NotFoundException('Organization not found');
    if (account.stripeCustomerId) return account.stripeCustomerId;
    const created = await this.call<{ id: string }>(config, 'customers', { email: user.email, name: account.name, metadata: { org_id: org.id, created_by: user.id } });
    await this.usage.setStripeCustomer(org.id, created.id);
    return created.id;
  }

  /** A Stripe Checkout page for a paid plan; the webhook sets the plan once it is paid. */
  async checkout(org: OrgContext, user: PublicUser, plan: string): Promise<{ url: string }> {
    const config = this.config();
    const price = config.prices[plan];
    if (!price) throw new BadRequestException(`Plan ${plan} cannot be bought`);
    const customer = await this.customer(config, org, user);
    const session = await this.call<{ url: string }>(config, 'checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: org.id,
      line_items: [{ price, quantity: 1 }],
      metadata: { org_id: org.id, plan },
      subscription_data: { metadata: { org_id: org.id, plan } },
      success_url: this.returnUrl('?checkout=done'),
      cancel_url: this.returnUrl('?checkout=cancelled'),
    });
    return { url: session.url };
  }

  /** Stripe's customer portal: change or cancel the subscription, invoices, card. */
  async portal(org: OrgContext): Promise<{ url: string }> {
    const config = this.config();
    const account = await this.usage.org(org.id);
    if (!account?.stripeCustomerId) throw new BadRequestException('This organization has no subscription to manage');
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
      const orgId = String(obj.client_reference_id ?? (obj.metadata as Record<string, string> | undefined)?.org_id ?? '');
      const plan = (obj.metadata as Record<string, string> | undefined)?.plan;
      if (!UUID.test(orgId) || !plan || !(plan in config.prices)) return false;
      if (typeof obj.customer === 'string') await this.usage.setStripeCustomer(orgId, obj.customer);
      const before = await this.usage.setSubscription(orgId, plan, typeof obj.subscription === 'string' ? obj.subscription : null);
      if (before === null) return false;
      this.noteChange(orgId, event, before, plan);
      return true;
    }
    if (event.type.startsWith('customer.subscription.')) {
      const sub = obj as unknown as Subscription;
      const orgId = (await this.usage.orgByStripeCustomer(sub.customer)) ?? sub.metadata?.org_id;
      if (!orgId || !UUID.test(orgId)) return false;
      const paid = event.type !== 'customer.subscription.deleted' && PAID_STATES.has(sub.status);
      const plan = paid ? (this.planOfPrice(config, sub.items?.data?.[0]?.price?.id) ?? sub.metadata?.plan) : 'free';
      if (!plan || (plan !== 'free' && !(plan in config.prices))) return false;
      const before = await this.usage.setSubscription(orgId, plan, paid ? sub.id : null);
      if (before === null) return false;
      this.noteChange(orgId, event, before, plan);
      return true;
    }
    return false;
  }

  private noteChange(orgId: string, event: StripeEvent, before: string, plan: string) {
    this.logger.log(`${event.type}: organization ${orgId} is now on ${plan}`);
    this.audit.note({ orgId, action: 'org.plan', entity: 'organization', entityId: orgId, before: { plan: before }, after: { plan, stripeEvent: event.id } });
  }
}
