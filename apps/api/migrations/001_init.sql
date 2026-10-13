-- Shipments, uploaded documents, their extraction, and each validation run with its findings.
-- Documents and findings keep their Zod-validated JSON in jsonb; columns hold what is queried.

create table shipments (
  id uuid primary key,
  reference text,
  destination text check (destination in ('CA', 'US')),
  transport_mode text check (transport_mode in ('SEA', 'AIR', 'ROAD')),
  status text not null,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  file_name text not null,
  storage_key text not null,
  sha256 text not null,
  page_count int not null,
  detected_type text not null,
  type_confidence real not null,
  language text,
  created_at timestamptz not null default now()
);
create index documents_shipment_idx on documents (shipment_id, created_at);

create table extractions (
  document_id uuid primary key references documents (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  raw jsonb,
  data jsonb,
  issues jsonb not null default '[]',
  -- PDF text lines with page and bbox, used to cite where evidence values are printed.
  pdf_lines jsonb not null,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create table validations (
  id uuid primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  ran jsonb not null,
  skipped jsonb not null,
  -- Which document fed each slot: { "invoice": "<document id>" | "body", ... }
  inputs jsonb not null,
  created_at timestamptz not null default now()
);
create index validations_shipment_idx on validations (shipment_id, created_at desc);

create table findings (
  -- Rule engine ids ("<shipment>:<rule>:<n>") repeat across runs, so the key includes the run.
  id text not null,
  validation_id uuid not null references validations (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  rule_id text not null,
  severity text not null,
  decided_by text not null,
  message text not null,
  evidence jsonb not null,
  regulation jsonb,
  suggested_fix text,
  agent_rationale text,
  primary key (validation_id, id)
);
create index findings_rule_idx on findings (rule_id);
