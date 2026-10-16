-- What the documents do not say and the duty estimate needs (related party, assists, freight, the
-- preference claimed, full tariff numbers...), one row per shipment, in the shipment's organization.
-- The estimate itself is not stored: it is computed from the current documents and the dated rate
-- tables in data/duties (global, edited by the server administrator).
create table if not exists shipment_duty_inputs (
  shipment_id uuid primary key references shipments (id) on delete cascade,
  org_id uuid references organizations (id) on delete cascade,
  inputs jsonb not null default '{}'::jsonb,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists shipment_duty_inputs_org_idx on shipment_duty_inputs (org_id);
create trigger shipment_duty_inputs_org before insert on shipment_duty_inputs for each row execute function dc_org_from_shipment();
