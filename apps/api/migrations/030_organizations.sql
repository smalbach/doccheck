-- Teams (docs/ORGANIZATIONS.md). Shipments, companies, products and conversations belong to an
-- organization instead of a user; every user gets a personal organization holding what they had,
-- so nothing they see changes. `user_id` columns stay as "created by". Also: invitations, roles,
-- shipments shared with clients, assignments, comments, notifications, two-step approval of
-- decisions, due dates, a hash-chained audit log, TOTP MFA, OIDC sign-in and a session list.

-- Organizations and members -------------------------------------------------------------------------

create table organizations (
  id uuid primary key,
  name text not null,
  -- Made for one user on sign-up (or by this migration); it can still take members.
  personal boolean not null default false,
  created_by uuid references users (id) on delete set null,
  -- Records retention in years per destination: CBSA asks for 6 (Customs Act s. 40, D17-1-21),
  -- CBP for 5 (19 CFR 163.4). The retention job deletes shipments older than this.
  retention_ca_years int not null default 6 check (retention_ca_years between 1 and 50),
  retention_us_years int not null default 5 check (retention_us_years between 1 and 50),
  -- Accepted risk and false positive need a reviewer's approval (two people) when set.
  require_approval boolean not null default false,
  -- Due date of a shipment with an ETA and no ISF deadline: this many hours before the ETA.
  sla_eta_lead_hours int not null default 48 check (sla_eta_lead_hours between 0 and 720),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_personal_idx on organizations (created_by) where personal;

create table org_members (
  org_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  -- owner and admin manage members and settings; analyst works shipments; reviewer decides and
  -- approves findings; viewer reads; client reads only the shipments shared with them.
  role text not null check (role in ('owner', 'admin', 'analyst', 'reviewer', 'viewer', 'client')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on org_members (user_id);

-- An emailed link (SHA-256 of the token stored) that adds whoever opens it signed in with that email.
create table org_invites (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'analyst', 'reviewer', 'viewer', 'client')),
  token_hash text not null unique,
  invited_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users (id) on delete set null
);
create index org_invites_org_idx on org_invites (org_id, created_at desc);

/** The personal organization made for a user. */
create function dc_personal_org(p_user uuid) returns uuid language sql stable as $$
  select id from organizations where personal and created_by = p_user order by created_at limit 1
$$;

insert into organizations (id, name, personal, created_by, created_at)
  select gen_random_uuid(), u.name, true, u.id, u.created_at from users u;
insert into org_members (org_id, user_id, role, created_at)
  select o.id, o.created_by, 'owner', o.created_at from organizations o where o.personal;

-- The organization the user worked in last: new sessions and mail sent to their intake address go there.
alter table users add column last_org_id uuid references organizations (id) on delete set null;
update users u set last_org_id = dc_personal_org(u.id);

-- Shipments ----------------------------------------------------------------------------------------

alter table shipments add column org_id uuid references organizations (id) on delete cascade;
update shipments set org_id = dc_personal_org(user_id) where user_id is not null;
create index shipments_org_idx on shipments (org_id, created_at desc);
-- The creator leaving no longer deletes the team's shipment.
alter table shipments drop constraint shipments_user_id_fkey;
alter table shipments add constraint shipments_user_id_fkey foreign key (user_id) references users (id) on delete set null;

-- Due date: set by hand (due_at), else from the ISF deadline or the ETA (shipment_due below).
alter table shipments add column eta date;
alter table shipments add column due_at timestamptz;
alter table shipments add column assignee_id uuid references users (id) on delete set null;

create table shipment_shares (
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  shared_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (shipment_id, user_id)
);
create index shipment_shares_user_idx on shipment_shares (user_id);

/**
 * When the shipment's documents are due, and why: 'manual' (set by hand), 'isf' (US ocean: 24 hours
 * before the cargo is laden, 19 CFR 149.2; the B/L's shipped-on-board date stands for lading), or
 * 'eta' (the organization's lead time before the ETA). Null when none is known.
 */
create view shipment_due as
  select s.id as shipment_id, s.org_id,
    coalesce(s.due_at, isf.due, eta.due) as due_at,
    case when s.due_at is not null then 'manual' when isf.due is not null then 'isf' when eta.due is not null then 'eta' end as due_source
  from shipments s
  left join organizations o on o.id = s.org_id
  left join lateral (
    select (min(b.shipped_on_board_date)::timestamp at time zone 'UTC') - interval '24 hours' as due
    from bills_of_lading b where b.shipment_id = s.id and s.destination = 'US' and coalesce(s.transport_mode, 'SEA') = 'SEA'
    having min(b.shipped_on_board_date) is not null
  ) isf on true
  left join lateral (
    select (s.eta::timestamp at time zone 'UTC') - make_interval(hours => coalesce(o.sla_eta_lead_hours, 48)) as due where s.eta is not null
  ) eta on true;

-- Extracted data and entities ----------------------------------------------------------------------

/** Rows tied to a shipment take its organization when stored. */
create function dc_org_from_shipment() returns trigger language plpgsql as $$
begin
  if new.org_id is null then
    select org_id into new.org_id from shipments where id = new.shipment_id;
  end if;
  return new;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['document_parties', 'invoices', 'invoice_lines', 'invoice_adjustments', 'packing_lists', 'packing_packages',
    'packing_contents', 'bills_of_lading', 'bl_containers', 'isf_details', 'progress_events', 'mail_intakes']
  loop
    execute format('alter table %I add column org_id uuid', t);
    execute format('update %I x set org_id = s.org_id from shipments s where s.id = x.shipment_id', t);
    execute format('create index %I on %I (org_id)', t || '_org_idx', t);
    execute format('create trigger %I before insert on %I for each row execute function dc_org_from_shipment()', t || '_org', t);
  end loop;
end $$;

-- Companies and products are one record per organization, whoever's document named them.
alter table parties add column org_id uuid references organizations (id) on delete cascade;
update parties set org_id = dc_personal_org(user_id) where user_id is not null;
alter table parties drop constraint parties_user_id_key_key;
alter table parties add constraint parties_org_key unique nulls not distinct (org_id, key);
alter table parties drop constraint parties_user_id_fkey;
alter table parties add constraint parties_user_id_fkey foreign key (user_id) references users (id) on delete set null;

alter table products add column org_id uuid references organizations (id) on delete cascade;
update products set org_id = dc_personal_org(user_id) where user_id is not null;
alter table products drop constraint products_user_id_key_key;
alter table products add constraint products_org_key unique nulls not distinct (org_id, key);
alter table products drop constraint products_user_id_fkey;
alter table products add constraint products_user_id_fkey foreign key (user_id) references users (id) on delete set null;
create index products_org_hs6_idx on products (org_id, hs6);

/** The organization being projected: set by dc_project_document and dc_project_isf for dc_party and dc_product. */
create function dc_projecting_org(p_user uuid) returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('dc.org', true), '')::uuid, dc_personal_org(p_user))
$$;

create or replace function dc_party(p_user uuid, p jsonb) returns uuid language plpgsql as $$
declare
  v_name text := dc_text(p->>'name');
  v_id uuid;
begin
  if jsonb_typeof(p) <> 'object' or v_name is null then return null; end if;
  insert into parties as t (id, user_id, org_id, key, name, country, tax_id)
  values (gen_random_uuid(), p_user, dc_projecting_org(p_user), coalesce(dc_norm(v_name), lower(v_name)), v_name, dc_text(p->'address'->>'country'), dc_text(p->>'taxId'))
  on conflict (org_id, key) do update
    set name = excluded.name, country = coalesce(excluded.country, t.country), tax_id = coalesce(excluded.tax_id, t.tax_id), last_seen_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function dc_product(p_user uuid, p_seller uuid, p_sku text, p_description text, p_hs text, p_origin text, p_unit text) returns uuid language plpgsql as $$
declare
  v_sku text := dc_text(p_sku);
  v_desc text := dc_text(p_description);
  v_key text;
  v_id uuid;
begin
  v_key := case when v_sku is not null then 'sku:' || upper(v_sku) when v_desc is not null then 'desc:' || coalesce(dc_norm(v_desc), lower(v_desc)) end;
  if v_key is null then return null; end if;
  insert into products as t (id, user_id, org_id, key, sku, description, hs_code, hs6, country_of_origin, unit, seller_id)
  values (gen_random_uuid(), p_user, dc_projecting_org(p_user), v_key, v_sku, coalesce(v_desc, v_sku), dc_text(p_hs), left(dc_hs(p_hs), 6), dc_text(p_origin), dc_text(p_unit), p_seller)
  on conflict (org_id, key) do update set
    description = coalesce(v_desc, t.description),
    hs_code = coalesce(excluded.hs_code, t.hs_code),
    hs6 = coalesce(excluded.hs6, t.hs6),
    country_of_origin = coalesce(excluded.country_of_origin, t.country_of_origin),
    unit = coalesce(excluded.unit, t.unit),
    seller_id = coalesce(excluded.seller_id, t.seller_id),
    last_seen_at = now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function dc_project_document(p_doc uuid) returns void language plpgsql as $$
declare
  r record;
begin
  delete from invoices where document_id = p_doc;
  delete from packing_lists where document_id = p_doc;
  delete from bills_of_lading where document_id = p_doc;
  delete from document_parties where document_id = p_doc and source <> 'ISF';

  select doc.shipment_id, doc.detected_type, doc.status, e.data, e.created_at, s.user_id, s.org_id into r
  from documents doc join extractions e on e.document_id = doc.id join shipments s on s.id = doc.shipment_id
  where doc.id = p_doc;
  if not found or r.status <> 'EXTRACTED' or jsonb_typeof(r.data) is distinct from 'object' then return; end if;
  perform set_config('dc.org', coalesce(r.org_id::text, ''), true);

  case r.detected_type
    when 'COMMERCIAL_INVOICE' then perform dc_project_invoice(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    when 'PACKING_LIST' then perform dc_project_packing_list(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    when 'BILL_OF_LADING' then perform dc_project_bill_of_lading(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    else null; -- ISF documents are projected from isf_filings, which is what validation uses.
  end case;
  perform set_config('dc.org', '', true);
end $$;

create or replace function dc_project_isf(p_ship uuid) returns void language plpgsql as $$
declare
  r record;
  v jsonb;
  d text;
begin
  delete from isf_details where shipment_id = p_ship;
  delete from document_parties where shipment_id = p_ship and source = 'ISF';

  select i.data, i.document_id, i.source, i.updated_at, s.user_id, s.org_id into r
  from isf_filings i join shipments s on s.id = i.shipment_id where i.shipment_id = p_ship;
  if not found or jsonb_typeof(r.data) is distinct from 'object' then return; end if;
  perform set_config('dc.org', coalesce(r.org_id::text, ''), true);
  v := r.data;
  d := dc_hs(v->>'htsCode');

  insert into isf_details (shipment_id, user_id, document_id, source, importer_of_record_number, consignee_number, country_of_origin, hts_code, hts_digits, hs6,
    seller_id, buyer_id, manufacturer_id, ship_to_id, consolidator_id,
    stuffing_address_lines, stuffing_city, stuffing_region, stuffing_postal_code, stuffing_country, updated_at, extra)
  values (p_ship, r.user_id, r.document_id, r.source, dc_text(v->>'importerOfRecordNumber'), dc_text(v->>'consigneeNumber'), dc_text(v->>'countryOfOrigin'),
    dc_text(v->>'htsCode'), d, case when length(d) >= 6 then left(d, 6) end,
    dc_document_party(r.document_id, p_ship, r.user_id, 'ISF', 'seller', v->'seller'),
    dc_document_party(r.document_id, p_ship, r.user_id, 'ISF', 'buyer', v->'buyer'),
    dc_document_party(r.document_id, p_ship, r.user_id, 'ISF', 'manufacturer', v->'manufacturer'),
    dc_document_party(r.document_id, p_ship, r.user_id, 'ISF', 'ship_to', v->'shipToParty'),
    dc_document_party(r.document_id, p_ship, r.user_id, 'ISF', 'consolidator', v->'consolidator'),
    array(select jsonb_array_elements_text(dc_array(v->'containerStuffingLocation'->'lines'))),
    dc_text(v->'containerStuffingLocation'->>'city'), dc_text(v->'containerStuffingLocation'->>'region'),
    dc_text(v->'containerStuffingLocation'->>'postalCode'), dc_text(v->'containerStuffingLocation'->>'country'), r.updated_at,
    dc_extra(v, array['seller', 'buyer', 'importerOfRecordNumber', 'consigneeNumber', 'manufacturer', 'shipToParty', 'countryOfOrigin', 'htsCode',
      'containerStuffingLocation', 'consolidator']));
  perform set_config('dc.org', '', true);
end $$;

-- A shipment moved to another organization takes its rows to that organization's companies and products.
create trigger shipments_project_org after update of org_id on shipments
  for each row when (old.org_id is distinct from new.org_id) execute function dc_on_shipment_owner();

-- Conversations ------------------------------------------------------------------------------------

alter table mail_threads add column org_id uuid references organizations (id) on delete cascade;
update mail_threads set org_id = coalesce((select org_id from shipments where id = mail_threads.shipment_id), dc_personal_org(user_id));
create index mail_threads_org_idx on mail_threads (org_id, last_message_at desc);
alter table mail_threads alter column user_id drop not null;
alter table mail_threads drop constraint mail_threads_user_id_fkey;
alter table mail_threads add constraint mail_threads_user_id_fkey foreign key (user_id) references users (id) on delete set null;

alter table mail_contacts add column org_id uuid references organizations (id) on delete cascade;
update mail_contacts set org_id = dc_personal_org(user_id);
alter table mail_contacts drop constraint mail_contacts_user_id_email_key;
alter table mail_contacts add constraint mail_contacts_org_email_key unique (org_id, email);
alter table mail_contacts alter column user_id drop not null;
alter table mail_contacts drop constraint mail_contacts_user_id_fkey;
alter table mail_contacts add constraint mail_contacts_user_id_fkey foreign key (user_id) references users (id) on delete set null;

update mail_intakes i set org_id = t.org_id from mail_threads t where t.id = i.thread_id and i.org_id is null;

-- Collaboration ------------------------------------------------------------------------------------

-- Who works a finding (by fingerprint, so it follows the finding across runs).
create table finding_assignments (
  shipment_id uuid not null references shipments (id) on delete cascade,
  fingerprint text not null,
  assignee_id uuid not null references users (id) on delete cascade,
  assigned_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (shipment_id, fingerprint)
);
create index finding_assignments_assignee_idx on finding_assignments (assignee_id);

-- A comment on a shipment, one of its findings (fingerprint) or documents (id).
create table comments (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  target_kind text not null check (target_kind in ('shipment', 'finding', 'document')),
  target_id text not null default '',
  user_id uuid references users (id) on delete set null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index comments_target_idx on comments (shipment_id, target_kind, target_id, created_at);

create table notifications (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  org_id uuid references organizations (id) on delete cascade,
  -- mention, assignment, approval_requested, approval_decided, invite
  kind text not null,
  shipment_id uuid references shipments (id) on delete cascade,
  actor_id uuid references users (id) on delete set null,
  detail jsonb not null default '{}',
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unread_idx on notifications (user_id) where read_at is null;

-- Per kind: { "mention": { "email": true, "inApp": true }, ... }; a missing kind uses the defaults.
alter table users add column notification_prefs jsonb not null default '{}';

-- Two-step decisions: an accepted risk or false positive asked for in an organization that requires
-- approval waits here until a reviewer (not the one who asked) approves it into finding_reviews.
create table review_requests (
  id uuid primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  fingerprint text not null,
  rule_id text not null,
  status text not null check (status in ('accepted', 'false_positive')),
  note text not null,
  requested_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  decision text check (decision in ('approved', 'rejected', 'withdrawn')),
  decided_by uuid references users (id) on delete set null,
  decision_note text,
  decided_at timestamptz
);
create index review_requests_pending_idx on review_requests (shipment_id, fingerprint) where decision is null;
alter table finding_reviews add column approved_by uuid references users (id) on delete set null;

-- Audit log ----------------------------------------------------------------------------------------

-- Every write, append-only: rows cannot be updated or deleted, and each row's hash covers the one
-- before it in the same organization, so removing or editing a row breaks the chain (GET /audit/verify).
-- No foreign keys: the log outlives the users and organizations it names.
create table audit_log (
  id bigserial primary key,
  org_id uuid,
  user_id uuid,
  user_email text,
  -- "shipment.update", "member.role", "finding.review", "http.post"...
  action text not null,
  entity text,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  at timestamptz not null default now(),
  prev_hash text not null,
  hash text not null
);
create index audit_log_org_idx on audit_log (org_id, id desc);
create index audit_log_entity_idx on audit_log (org_id, entity, entity_id);

/** The text a row's hash covers: every column but the hash, in a fixed order. */
create function dc_audit_payload(a audit_log) returns text language sql immutable as $$
  select concat_ws('|', a.prev_hash, coalesce(a.org_id::text, ''), coalesce(a.user_id::text, ''), coalesce(a.user_email, ''), a.action,
    coalesce(a.entity, ''), coalesce(a.entity_id, ''), coalesce(a.before::text, ''), coalesce(a.after::text, ''), coalesce(a.ip, ''),
    to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;

create function dc_audit_chain() returns trigger language plpgsql as $$
begin
  -- One writer per organization at a time, so two rows never share a predecessor.
  perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(new.org_id::text, '')));
  select hash into new.prev_hash from audit_log where org_id is not distinct from new.org_id order by id desc limit 1;
  new.prev_hash := coalesce(new.prev_hash, repeat('0', 64));
  new.at := clock_timestamp();
  new.hash := encode(sha256(convert_to(dc_audit_payload(new), 'UTF8')), 'hex');
  return new;
end $$;
create trigger audit_log_chain before insert on audit_log for each row execute function dc_audit_chain();

create function dc_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_append_only before update or delete on audit_log for each row execute function dc_audit_append_only();
create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function dc_audit_append_only();

-- Sign-in: sessions, MFA, SSO ------------------------------------------------------------------------

alter table sessions add column id uuid not null default gen_random_uuid() unique;
alter table sessions add column org_id uuid references organizations (id) on delete set null;
alter table sessions add column ip text;
alter table sessions add column user_agent text;
alter table sessions add column method text not null default 'password' check (method in ('password', 'sso', 'reset'));
alter table sessions add column last_seen_at timestamptz not null default now();

-- TOTP (RFC 6238): the secret sealed like the mail password (secret-box.ts); pending until confirmed.
alter table users add column mfa_secret jsonb;
alter table users add column mfa_pending_secret jsonb;
alter table users add column mfa_enabled_at timestamptz;
-- The last time step a code was accepted for: a code works once.
alter table users add column mfa_last_counter bigint;
-- An SSO-only account has no usable password (password_hash '!').

create table mfa_recovery_codes (
  user_id uuid not null references users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  primary key (user_id, code_hash)
);

-- Between the password and the code: a short-lived ticket (hash stored), a few tries.
create table mfa_challenges (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  org_id uuid,
  attempts int not null default 0,
  expires_at timestamptz not null
);

-- OpenID Connect sign-in per organization (any provider: Entra ID, Okta, Google, Keycloak...).
create table org_sso (
  org_id uuid primary key references organizations (id) on delete cascade,
  enabled boolean not null default false,
  issuer text not null,
  client_id text not null,
  client_secret jsonb not null,
  -- Who may sign in: emails in these domains (empty: anyone the provider vouches for).
  email_domains text[] not null default '{}',
  -- Role of a member added on first sign-in.
  default_role text not null default 'viewer' check (default_role in ('admin', 'analyst', 'reviewer', 'viewer')),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);

create table sso_states (
  state_hash text primary key,
  org_id uuid not null references organizations (id) on delete cascade,
  nonce text not null,
  code_verifier text not null,
  expires_at timestamptz not null
);
