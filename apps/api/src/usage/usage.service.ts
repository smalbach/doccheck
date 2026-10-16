import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
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
  /**
   * Organizations owned by a server admin are counted but never refused; USAGE_ENFORCEMENT=false turns
   * refusals off for everyone.
   */
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
 * Monthly usage per organization: counted when a document's extraction is saved and when a validation
 * run is saved; checked before an upload, a re-extraction or a validation starts.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly repo: UsageRepository,
    private readonly audit: AuditService,
  ) {}

  private enforcementOn() {
    return !isDemo() && process.env.USAGE_ENFORCEMENT !== 'false';
  }

  plans() {
    return this.repo.plans();
  }

  async usage(orgId: string, now = new Date()): Promise<UsageView> {
    const account = await this.repo.org(orgId);
    if (!account) throw new NotFoundException('Organization not found');
    const month = monthOf(now);
    const [counts, history] = await Promise.all([this.repo.counts(orgId, month), this.repo.history(orgId, 12)]);
    return {
      plan: account.plan,
      month,
      resetsAt: nextMonth(now).toISOString(),
      meters: USAGE_KINDS.map((k) => meter(account.plan, k, counts[k])),
      enforced: this.enforcementOn() && !account.adminOwned,
      history,
    };
  }

  /**
   * Refuses with 402 when `adding` more units would pass a hard limit of the plan of the shipment's
   * organization. Organizations owned by a server admin, the read-only demo and USAGE_ENFORCEMENT=false
   * are never refused.
   */
  async assertAllowed(shipmentId: string, kind: UsageKind, adding = 1, now = new Date()): Promise<void> {
    if (!this.enforcementOn()) return;
    const orgId = await this.repo.shipmentOrg(shipmentId);
    if (!orgId) return;
    const account = await this.repo.org(orgId);
    if (!account || account.adminOwned) return;
    const month = monthOf(now);
    const used = (await this.repo.counts(orgId, month))[kind];
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
    const saved = await this.repo.updatePlan(id, p, adminId);
    if (!saved) throw new NotFoundException(`Plan ${id} not found`);
    this.audit.note({ orgId: null, action: 'plan.update', entity: 'plan', entityId: id, before: saved.before, after: saved.after });
    return saved.after;
  }

  async orgs(now = new Date()) {
    return { month: monthOf(now), orgs: await this.repo.orgs(monthOf(now)) };
  }

  /** Puts an organization on a plan by hand (server admin). */
  async setPlan(orgId: string, planId: string) {
    if (!(await this.repo.plans()).some((p) => p.id === planId)) throw new BadRequestException(`Unknown plan ${planId}`);
    const before = await this.repo.setPlan(orgId, planId);
    if (before === null) throw new NotFoundException(`Organization ${orgId} not found`);
    this.audit.note({ orgId, action: 'org.plan', entity: 'organization', entityId: orgId, before: { plan: before }, after: { plan: planId } });
    return this.orgs();
  }
}
