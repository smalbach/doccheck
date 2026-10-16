-- What the documents do not say and the duty estimate needs (related party, assists, freight, the
-- preference claimed, full tariff numbers...), one row per shipment. The estimate itself is not
-- stored: it is computed from the current documents and the dated rate tables in data/duties.
create table if not exists shipment_duty_inputs (
  shipment_id uuid primary key references shipments (id) on delete cascade,
  inputs jsonb not null default '{}'::jsonb,
  updated_by uuid references users (id) on delete set null,
  updated_at timestamptz not null default now()
);
