-- Rule settings and purchase orders. An account can turn rules off, change their severity and edit
-- tolerances (packages/rules RuleConfig); the config is stored per scope (a user today, an organization
-- later: the same row shape, resolved organization first, then user). Only what differs from the
-- defaults is stored, so an empty config means the default behaviour.
--
-- Each validation run records the config it applied, the tolerances in effect, the run date and what
-- account history it compared with, so its findings can be explained and the run replayed.
--
-- Purchase orders are imported by the account (CSV or JSON) for the three-way match of rule X24.

create table rule_settings (
  scope text not null check (scope in ('user', 'organization')),
  scope_id uuid not null,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null,
  primary key (scope, scope_id)
);

alter table validations add column rule_config jsonb;

create table purchase_orders (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
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
  unique (user_id, po_key)
);
