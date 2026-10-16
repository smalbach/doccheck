-- Supplier portal (docs/PORTAL.md): a page a supplier opens from a link, without an account, to see
-- what to correct and upload corrected documents (a correction request), or to check draft documents
-- before shipping (a pre-shipment check). Every link reaches one request and nothing else.
-- Everything belongs to the organization of the request's shipment (docs/ORGANIZATIONS.md); a
-- token resolves its organization from its own request, never from a session.

-- What a supplier is asked through the portal: the corrections of a correction-request conversation,
-- or a pre-shipment check of a draft shipment made for it. Its conversation shows what happens.
create table portal_requests (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  -- Who made it (stays when they leave the organization).
  user_id uuid references users (id) on delete set null,
  kind text not null check (kind in ('correction', 'pre_shipment')),
  -- correction: the importer's shipment; pre_shipment: the draft shipment the supplier's uploads go to.
  shipment_id uuid not null references shipments (id) on delete cascade,
  party_id uuid references parties (id) on delete set null,
  -- The supplier's name as the importer wrote it, when it is not (yet) a company in the account.
  supplier_name text,
  thread_id uuid references mail_threads (id) on delete set null,
  -- Pre-shipment: the order or reference the importer gave.
  reference text,
  language text check (language in ('en', 'es', 'fr')),
  -- Correction: the findings the request is about (fingerprints of the validation it was made from).
  fingerprints text[] not null default '{}',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index portal_requests_org_idx on portal_requests (org_id, created_at desc);
create index portal_requests_party_idx on portal_requests (party_id, created_at desc);
create index portal_requests_thread_idx on portal_requests (thread_id);

-- A link to a request. Only a SHA-256 of the token is kept; the token itself is an HMAC of the link id
-- with the server's key, so the app can show the link again without storing it.
create table portal_links (
  id uuid primary key,
  request_id uuid not null references portal_requests (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid references users (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index portal_links_request_idx on portal_links (request_id, created_at desc);

-- Every use of the portal, and every refused one (request_id is null for a token that matched nothing).
create table portal_events (
  id uuid primary key,
  request_id uuid references portal_requests (id) on delete cascade,
  -- Null with the request, for a token that matched nothing.
  org_id uuid references organizations (id) on delete cascade,
  link_id uuid references portal_links (id) on delete set null,
  kind text not null check (kind in ('link_created', 'link_revoked', 'opened', 'uploaded', 'upload_refused', 'checked', 'denied')),
  ip text,
  user_agent text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index portal_events_request_idx on portal_events (request_id, created_at desc);
create index portal_events_denied_idx on portal_events (created_at) where request_id is null;

-- PDFs a supplier uploaded at once: extracted into the request's shipment, then validated.
create table portal_uploads (
  id uuid primary key,
  request_id uuid not null references portal_requests (id) on delete cascade,
  org_id uuid not null references organizations (id) on delete cascade,
  -- The received message of the conversation that holds the files as attachments.
  message_id uuid references mail_messages (id) on delete set null,
  document_ids uuid[] not null default '{}',
  -- extracting → validating → validated | failed
  status text not null check (status in ('extracting', 'validating', 'validated', 'failed')),
  findings int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index portal_uploads_request_idx on portal_uploads (request_id, created_at desc);
create index portal_uploads_pending_idx on portal_uploads (created_at) where status in ('extracting', 'validating');
