import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isDemo } from '../demo/demo-mode';
import { allows, meter, monthOf, nextMonth, USAGE_KINDS, type Meter, type Plan, type UsageKind } from './limits';
import { UsageRepository } from './usage.repository';

const KIND_TEXT: Record<UsageKind, [string, string]> = { extraction: ['document extraction', 'document extractions'], validation: ['validation', 'validations'] };

export interface UsageView {
  plan: Plan;
  month: string;
  /** When the counters start again (ISO). */
  resetsAt: string;
  meters: Meter[];
  /** Admins are counted but never refused; USAGE_ENFORCEMENT=false turns refusals off for everyone. */
  enforced: boolean;
  history: { month: string; extraction: number; validation: number }[];
}

/** Body of the 402 a hard limit answers with; the web shows it with a link to the usage page. */
export interface LimitReached {
  statusCode: 402;
  code: 'usage_limit';
  kind: UsageKind;
  used: number;
  limit: number;
  plan: string;
  resetsAt: string;
  message: string;
}

/**
 * Monthly usage per account: counted when a document's extraction is saved and when a validation
 * run is saved; checked before an upload, a re-extraction or a validation starts.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly repo: UsageRepository) {}

  private enforcementOn() {
    return !isDemo() && process.env.USAGE_ENFORCEMENT !== 'false';
  }

  plans() {
    return this.repo.plans();
  }

  async usage(userId: string, now = new Date()): Promise<UsageView> {
    const account = await this.repo.account(userId);
    if (!account) throw new NotFoundException('Account not found');
    const month = monthOf(now);
    const [counts, history] = await Promise.all([this.repo.counts(userId, month), this.repo.history(userId, 12)]);
    return {
      plan: account.plan,
      month,
      resetsAt: nextMonth(now).toISOString(),
      meters: USAGE_KINDS.map((k) => meter(account.plan, k, counts[k])),
      enforced: this.enforcementOn() && account.role !== 'admin',
      history,
    };
  }

  /**
   * Refuses with 402 when `adding` more units would pass a hard limit of the shipment owner's plan.
   * Admins, the read-only demo and USAGE_ENFORCEMENT=false are never refused.
   */
  async assertAllowed(shipmentId: string, kind: UsageKind, adding = 1, now = new Date()): Promise<void> {
    if (!this.enforcementOn()) return;
    const userId = await this.repo.shipmentOwner(shipmentId);
    if (!userId) return;
    const account = await this.repo.account(userId);
    if (!account || account.role === 'admin') return;
    const month = monthOf(now);
    const used = (await this.repo.counts(userId, month))[kind];
    if (allows(account.plan, kind, used, adding)) return;
    const limit = (kind === 'extraction' ? account.plan.extractionsPerMonth : account.plan.validationsPerMonth) ?? 0;
    const resetsAt = nextMonth(now).toISOString();
    const left = Math.max(0, limit - used);
    const body: LimitReached = {
      statusCode: 402,
      code: 'usage_limit',
      kind,
      used,
      limit,
      plan: account.plan.id,
      resetsAt,
      message:
        `The ${account.plan.name} plan includes ${limit} ${KIND_TEXT[kind][limit === 1 ? 0 : 1]} a month and ${used} ${used === 1 ? 'is' : 'are'} used` +
        (adding > 1 && left > 0 ? ` (${left} left, ${adding} asked)` : '') +
        `. Upgrade the plan or wait until ${resetsAt.slice(0, 10)}.`,
    };
    throw new HttpException(body, HttpStatus.PAYMENT_REQUIRED);
  }

  /** Counts work that was done. Never fails the work: a counter that cannot be written is logged. */
  async record(shipmentId: string, kind: UsageKind, n = 1, now = new Date()): Promise<void> {
    try {
      await this.repo.record(shipmentId, kind, monthOf(now), n);
    } catch (err) {
      this.logger.warn(`Usage not counted (${kind}, shipment ${shipmentId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async updatePlan(id: string, p: Omit<Plan, 'id' | 'position'>, adminId: string) {
    const plan = await this.repo.updatePlan(id, p, adminId);
    if (!plan) throw new NotFoundException(`Plan ${id} not found`);
    return plan;
  }

  async accounts(now = new Date()) {
    return { month: monthOf(now), accounts: await this.repo.accounts(monthOf(now)) };
  }

  async setPlan(userId: string, planId: string) {
    if (!(await this.repo.plans()).some((p) => p.id === planId)) throw new BadRequestException(`Unknown plan ${planId}`);
    if (!(await this.repo.setPlan(userId, planId))) throw new NotFoundException(`User ${userId} not found`);
    return this.accounts();
  }
}
