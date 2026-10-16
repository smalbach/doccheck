import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { Plan, UsageKind } from './limits';

interface PlanRow {
  id: string;
  name: string;
  position: number;
  extractions_per_month: number | null;
  validations_per_month: number | null;
  warn_percent: number;
  enforcement: Plan['enforcement'];
}

const toPlan = (r: PlanRow): Plan => ({
  id: r.id,
  name: r.name,
  position: r.position,
  extractionsPerMonth: r.extractions_per_month,
  validationsPerMonth: r.validations_per_month,
  warnPercent: r.warn_percent,
  enforcement: r.enforcement,
});

/** An organization as metering and billing see it. */
export interface OrgAccount {
  orgId: string;
  name: string;
  plan: Plan;
  /** An owner of the organization is a server admin: counted, never refused. */
  adminOwned: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

@Injectable()
export class UsageRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async plans(): Promise<Plan[]> {
    const { rows } = await this.pool.query<PlanRow>('select * from plans order by position, id');
    return rows.map(toPlan);
  }

  async updatePlan(id: string, p: Omit<Plan, 'id' | 'position'>, userId: string): Promise<{ before: Plan; after: Plan } | null> {
    const before = (await this.pool.query<PlanRow>('select * from plans where id = $1', [id])).rows[0];
    if (!before) return null;
    const { rows } = await this.pool.query<PlanRow>(
      `update plans set name = $2, extractions_per_month = $3, validations_per_month = $4, warn_percent = $5, enforcement = $6, updated_at = now(), updated_by = $7
       where id = $1 returning *`,
      [id, p.name, p.extractionsPerMonth, p.validationsPerMonth, p.warnPercent, p.enforcement, userId],
    );
    return rows[0] ? { before: toPlan(before), after: toPlan(rows[0]) } : null;
  }

  async org(orgId: string): Promise<OrgAccount | null> {
    const { rows } = await this.pool.query(
      `select o.id as org_id, o.name as org_name, o.stripe_customer_id, o.stripe_subscription_id, p.*,
              exists (select 1 from org_members m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner' and u.role = 'admin') as admin_owned
       from organizations o join plans p on p.id = o.plan where o.id = $1`,
      [orgId],
    );
    const r = rows[0];
    return r
      ? { orgId: r.org_id, name: r.org_name, plan: toPlan(r), adminOwned: r.admin_owned, stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id }
      : null;
  }

  /** The organization of a shipment (null for rows from before accounts, which nobody meters). */
  async shipmentOrg(shipmentId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ org_id: string | null }>('select org_id from shipments where id = $1', [shipmentId]);
    return rows[0]?.org_id ?? null;
  }

  /** This month's counts of an organization. */
  async counts(orgId: string, month: string): Promise<Record<UsageKind, number>> {
    const { rows } = await this.pool.query<{ kind: UsageKind; count: number }>('select kind, count from usage_counters where org_id = $1 and month = $2', [orgId, month]);
    const counts: Record<UsageKind, number> = { extraction: 0, validation: 0 };
    for (const r of rows) counts[r.kind] = r.count;
    return counts;
  }

  /** Counts per month, newest first, for the last `months` months that have any. */
  async history(orgId: string, months: number): Promise<{ month: string; extraction: number; validation: number }[]> {
    const { rows } = await this.pool.query<{ month: string; extraction: number; validation: number }>(
      `select to_char(month, 'YYYY-MM-DD') as month,
              coalesce(sum(count) filter (where kind = 'extraction'), 0)::int as extraction,
              coalesce(sum(count) filter (where kind = 'validation'), 0)::int as validation
       from usage_counters where org_id = $1 group by month order by month desc limit $2`,
      [orgId, months],
    );
    return rows;
  }

  /** Adds to this month's counter of the shipment's organization. */
  async record(shipmentId: string, kind: UsageKind, month: string, n = 1): Promise<void> {
    await this.pool.query(
      `insert into usage_counters (org_id, month, kind, count)
       select org_id, $2::date, $3, $4 from shipments where id = $1 and org_id is not null
       on conflict (org_id, month, kind) do update set count = usage_counters.count + excluded.count`,
      [shipmentId, month, kind, n],
    );
  }

  /** Every organization's counts this month with its plan, for the server admin. */
  async orgs(month: string): Promise<{ orgId: string; name: string; personal: boolean; owner: string | null; plan: string; extraction: number; validation: number }[]> {
    const { rows } = await this.pool.query(
      `select o.id, o.name, o.personal, o.plan,
              (select u.email from org_members m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1) as owner,
              coalesce(sum(c.count) filter (where c.kind = 'extraction'), 0)::int as extraction,
              coalesce(sum(c.count) filter (where c.kind = 'validation'), 0)::int as validation
       from organizations o left join usage_counters c on c.org_id = o.id and c.month = $1
       group by o.id order by o.created_at`,
      [month],
    );
    return rows.map((r) => ({ orgId: r.id, name: r.name, personal: r.personal, owner: r.owner, plan: r.plan, extraction: r.extraction, validation: r.validation }));
  }

  /** Sets an organization's plan; the plan it had, or null when there is no such organization. */
  async setPlan(orgId: string, plan: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ before: string }>(
      'update organizations o set plan = $2 from organizations old where o.id = $1 and old.id = o.id returning old.plan as before',
      [orgId, plan],
    );
    return rows[0]?.before ?? null;
  }

  // Billing (Stripe, test mode).

  async setStripeCustomer(orgId: string, customerId: string): Promise<void> {
    await this.pool.query('update organizations set stripe_customer_id = $2 where id = $1', [orgId, customerId]);
  }

  async orgByStripeCustomer(customerId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>('select id from organizations where stripe_customer_id = $1', [customerId]);
    return rows[0]?.id ?? null;
  }

  async setSubscription(orgId: string, plan: string, subscriptionId: string | null): Promise<string | null> {
    const { rows } = await this.pool.query<{ before: string }>(
      'update organizations o set plan = $2, stripe_subscription_id = $3 from organizations old where o.id = $1 and old.id = o.id returning old.plan as before',
      [orgId, plan, subscriptionId],
    );
    return rows[0]?.before ?? null;
  }

  /** Records a webhook event; false when it was already applied. */
  async claimEvent(id: string, type: string): Promise<boolean> {
    const res = await this.pool.query('insert into billing_events (id, type) values ($1, $2) on conflict do nothing', [id, type]);
    return (res.rowCount ?? 0) > 0;
  }

  async forgetEvent(id: string): Promise<void> {
    await this.pool.query('delete from billing_events where id = $1', [id]);
  }
}
