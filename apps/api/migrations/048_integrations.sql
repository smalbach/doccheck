-- Integrations (docs/INTEGRATIONS.md): API keys for the public REST API, idempotency of its writes,
-- the events other systems hear about, webhooks and chat alerts with their delivery log, folder
-- ingestion, and container tracking.
--
-- Everything belongs to an organization (migration 040) and goes with it. created_by is the member
-- who set it up, kept when they leave; a key acts in its organization with the scopes it was given,
-- and shipments it creates are recorded as created by that member.

create table api_keys (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  name text not null,
  -- The start of the key ("dck_k3x9p2ab"), shown in lists so a key can be recognized. The key
  -- itself is shown once, when it is made; only its SHA-256 is kept.
  prefix text not null,
  hash text not null unique,
  scopes text[] not null check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0),
  -- Requests per minute.
  rate_limit int not null default 120 check (rate_limit between 1 and 10000),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index api_keys_org_idx on api_keys (org_id, created_at desc);

-- A write sent again with the same Idempotency-Key answers what the first one answered. Rows with
-- no response are in progress; all are dropped after a day.
create table api_idempotency (
  key_id uuid not null references api_keys (id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  status int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (key_id, idempotency_key)
);

-- What happened, once per event however many API processes saw it (dedupe_key is unique).
create table integration_events (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  type text not null,
  shipment_id uuid references shipments (id) on delete set null,
  dedupe_key text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index integration_events_org_idx on integration_events (org_id, created_at desc);

create table webhook_subscriptions (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  url text not null,
  description text,
  events text[] not null,
  -- The signing secret, sealed with the settings key (it must be read back to sign).
  secret jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index webhook_subscriptions_org_idx on webhook_subscriptions (org_id);

create table chat_alerts (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  kind text not null check (kind in ('slack', 'teams')),
  name text not null,
  -- The incoming-webhook URL is a credential: sealed, and only its host is shown.
  url jsonb not null,
  url_host text not null,
  events text[] not null,
  include_details boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index chat_alerts_org_idx on chat_alerts (org_id);

-- One row per event per target (webhook or chat alert), with every attempt's outcome. A redelivery
-- is a new row pointing at the one it repeats.
create table integration_deliveries (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  target_type text not null check (target_type in ('webhook', 'chat')),
  target_id uuid not null,
  event_id uuid references integration_events (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  attempts int not null default 0,
  response_status int,
  response_body text,
  error text,
  duration_ms int,
  next_attempt_at timestamptz,
  redelivery_of uuid references integration_deliveries (id) on delete set null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create unique index integration_deliveries_once_idx on integration_deliveries (target_id, event_id) where redelivery_of is null and event_id is not null;
create index integration_deliveries_target_idx on integration_deliveries (target_id, created_at desc);
create index integration_deliveries_due_idx on integration_deliveries (next_attempt_at) where status = 'pending';

-- Where the API left off reading other tables for events (received supplier mail).
create table integration_cursors (
  name text primary key,
  position timestamptz not null
);

-- Folder ingestion: an SFTP server, a local folder or an S3 prefix watched for PDFs.
create table ingestion_sources (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  created_by uuid references users (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('sftp', 'local', 's3')),
  -- Host, port, user, path, bucket, prefix, endpoint, region: nothing secret.
  config jsonb not null,
  -- Password, private key or secret access key, sealed with the settings key.
  secret jsonb,
  group_by text not null check (group_by in ('folder', 'filename')),
  pattern text,
  destination text check (destination in ('CA', 'US')),
  validate boolean not null default true,
  poll_seconds int not null default 300 check (poll_seconds between 30 and 86400),
  active boolean not null default true,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- Every file seen, once (by path and size/modification): which shipment it went to, or why not.
create table ingested_files (
  id uuid primary key,
  source_id uuid not null references ingestion_sources (id) on delete cascade,
  path text not null,
  version text not null,
  reference text,
  shipment_id uuid references shipments (id) on delete set null,
  document_id uuid,
  status text not null check (status in ('imported', 'skipped', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (source_id, path, version)
);
create index ingested_files_source_idx on ingested_files (source_id, created_at desc);

-- Container tracking, off until the organization turns it on.
create table tracking_settings (
  org_id uuid primary key references organizations (id) on delete cascade,
  updated_by uuid references users (id) on delete set null,
  enabled boolean not null default false,
  provider text not null default 'mock' check (provider in ('mock', 'project44', 'vizion', 'terminal49')),
  endpoint text,
  api_key jsonb,
  mock_scenario text not null default 'consistent' check (mock_scenario in ('consistent', 'conflicting')),
  updated_at timestamptz not null default now()
);

-- The events fetched for a validation's containers, kept to show what the T findings compared.
create table tracking_snapshots (
  validation_id uuid primary key references validations (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  provider text not null,
  events jsonb not null,
  findings int not null,
  error text,
  created_at timestamptz not null default now()
);
create index tracking_snapshots_shipment_idx on tracking_snapshots (shipment_id, created_at desc);
