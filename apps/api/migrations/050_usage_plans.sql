-- Usage metering and plans. Each organization counts the documents it had extracted and the
-- validations it ran, per calendar month (UTC). A plan sets the monthly limits; server admins edit
-- them. The plan, and its Stripe customer, belong to the organization (its owners and admins buy it).
-- At warn_percent of a limit the web warns (soft limit); at the limit a 'hard' plan refuses more
-- work with 402 until the next month or an upgrade, a 'soft' plan lets it through and shows the overage.

create table plans (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{0,30}$'),
  name text not null,
  position int not null default 0,
  -- null: unlimited.
  extractions_per_month int check (extractions_per_month >= 0),
  validations_per_month int check (validations_per_month >= 0),
  warn_percent int not null default 80 check (warn_percent between 1 and 100),
  enforcement text not null default 'hard' check (enforcement in ('soft', 'hard')),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);

insert into plans (id, name, position, extractions_per_month, validations_per_month, warn_percent, enforcement) values
  ('free', 'Free', 0, 50, 100, 80, 'hard'),
  ('pro', 'Pro', 1, 1000, 2000, 80, 'soft'),
  ('business', 'Business', 2, null, null, 80, 'soft');

alter table organizations add column plan text not null default 'free' references plans (id) on update cascade;
-- Set by the Stripe webhook (test mode only, see docs/BILLING.md); null without billing.
alter table organizations add column stripe_customer_id text unique;
alter table organizations add column stripe_subscription_id text;

create table usage_counters (
  org_id uuid not null references organizations (id) on delete cascade,
  -- First day of the month, UTC.
  month date not null,
  kind text not null check (kind in ('extraction', 'validation')),
  count int not null default 0,
  primary key (org_id, month, kind)
);

-- Stripe webhook events already applied: Stripe retries, and an event must count once.
create table billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
