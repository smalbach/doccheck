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

export interface Account {
  userId: string;
  role: string;
  plan: Plan;
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

  async updatePlan(id: string, p: Omit<Plan, 'id' | 'position'>, userId: string): Promise<Plan | null> {
    const { rows } = await this.pool.query<PlanRow>(
      `update plans set name = $2, extractions_per_month = $3, validations_per_month = $4, warn_percent = $5, enforcement = $6, updated_at = now(), updated_by = $7
       where id = $1 returning *`,
      [id, p.name, p.extractionsPerMonth, p.validationsPerMonth, p.warnPercent, p.enforcement, userId],
    );
    return rows[0] ? toPlan(rows[0]) : null;
  }

  async account(userId: string): Promise<Account | null> {
    const { rows } = await this.pool.query(
      `select u.id as user_id, u.role, u.stripe_customer_id, u.stripe_subscription_id, p.*
       from users u join plans p on p.id = u.plan where u.id = $1`,
      [userId],
    );
    const r = rows[0];
    return r ? { userId: r.user_id, role: r.role, plan: toPlan(r), stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id } : null;
  }

  /** The owner of a shipment (null for rows from before accounts, which nobody meters). */
  async shipmentOwner(shipmentId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string | null }>('select user_id from shipments where id = $1', [shipmentId]);
    return rows[0]?.user_id ?? null;
  }

  /** This month's counts of an account. */
  async counts(userId: string, month: string): Promise<Record<UsageKind, number>> {
    const { rows } = await this.pool.query<{ kind: UsageKind; count: number }>('select kind, count from usage_counters where user_id = $1 and month = $2', [userId, month]);
    const counts: Record<UsageKind, number> = { extraction: 0, validation: 0 };
    for (const r of rows) counts[r.kind] = r.count;
    return counts;
  }

  /** Counts per month, newest first, for the last `months` months that have any. */
  async history(userId: string, months: number): Promise<{ month: string; extraction: number; validation: number }[]> {
    const { rows } = await this.pool.query<{ month: string; extraction: number; validation: number }>(
      `select to_char(month, 'YYYY-MM-DD') as month,
              coalesce(sum(count) filter (where kind = 'extraction'), 0)::int as extraction,
              coalesce(sum(count) filter (where kind = 'validation'), 0)::int as validation
       from usage_counters where user_id = $1 group by month order by month desc limit $2`,
      [userId, months],
    );
    return rows;
  }

  /** Adds to this month's counter of the shipment's owner. */
  async record(shipmentId: string, kind: UsageKind, month: string, n = 1): Promise<void> {
    await this.pool.query(
      `insert into usage_counters (user_id, month, kind, count)
       select user_id, $2::date, $3, $4 from shipments where id = $1 and user_id is not null
       on conflict (user_id, month, kind) do update set count = usage_counters.count + excluded.count`,
      [shipmentId, month, kind, n],
    );
  }

  /** Every account's counts this month with its plan, for the admin. */
  async accounts(month: string): Promise<{ userId: string; email: string; plan: string; extraction: number; validation: number }[]> {
    const { rows } = await this.pool.query(
      `select u.id, u.email, u.plan,
              coalesce(sum(c.count) filter (where c.kind = 'extraction'), 0)::int as extraction,
              coalesce(sum(c.count) filter (where c.kind = 'validation'), 0)::int as validation
       from users u left join usage_counters c on c.user_id = u.id and c.month = $1
       group by u.id order by u.created_at`,
      [month],
    );
    return rows.map((r) => ({ userId: r.id, email: r.email, plan: r.plan, extraction: r.extraction, validation: r.validation }));
  }

  async setPlan(userId: string, plan: string): Promise<boolean> {
    const res = await this.pool.query('update users set plan = $2, updated_at = now() where id = $1', [userId, plan]);
    return (res.rowCount ?? 0) > 0;
  }

  // Billing (Stripe, test mode).

  async setStripeCustomer(userId: string, customerId: string): Promise<void> {
    await this.pool.query('update users set stripe_customer_id = $2 where id = $1', [userId, customerId]);
  }

  async userByStripeCustomer(customerId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>('select id from users where stripe_customer_id = $1', [customerId]);
    return rows[0]?.id ?? null;
  }

  async setSubscription(userId: string, plan: string, subscriptionId: string | null): Promise<void> {
    await this.pool.query('update users set plan = $2, stripe_subscription_id = $3, updated_at = now() where id = $1', [userId, plan, subscriptionId]);
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
