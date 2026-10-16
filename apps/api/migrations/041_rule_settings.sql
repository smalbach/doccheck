-- Rule settings and purchase orders, per organization (docs/ORGANIZATIONS.md). An organization can turn
-- rules off, change their severity and edit tolerances (packages/rules RuleConfig). Only what differs
-- from the defaults is stored, so no row (or an empty config) means the default behaviour.
--
-- Each validation run records the config it applied, the tolerances in effect, the run date and what
-- account history it compared with, so its findings can be explained and the run replayed.
--
-- Purchase orders are imported by the organization (CSV or JSON) for the three-way match of rule X24.

create table rule_settings (
  org_id uuid primary key references organizations (id) on delete cascade,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);

alter table validations add column rule_config jsonb;

create table purchase_orders (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  -- Who imported it.
  user_id uuid references users (id) on delete set null,
  po_number text not null,
  -- The key POs are found by: upper case, letters and digits only ("PO-4411" = "po 4411").
  po_key text not null,
  seller_name text,
  currency text,
  order_date date,
  -- [{ lineNo?, sku?, description?, quantity, unit?, unitPrice? }], decimals as strings.
  lines jsonb not null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, po_key)
);
