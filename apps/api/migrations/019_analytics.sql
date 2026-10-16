-- Analytics (docs/ANALYTICS.md): the views Data Q&A queries run against, a read-only role for them,
-- each account's cost assumptions, and the snapshot of regulation passages the scheduled check
-- compares against to report what changed.

-- Data Q&A -----------------------------------------------------------------------------------------
-- Every view in schema qa shows only the rows of the account in the transaction setting
-- doccheck.qa_user, which the API sets (set_config(..., true)) before running a checked query. With
-- the setting missing the views are empty. The SQL guard refuses set_config and current_setting, and
-- the role below can read nothing but these views.

-- "if not exists": a test reset drops schema public with cascade, which empties qa but keeps it.
create schema if not exists qa;

create function dc_qa_user() returns uuid language sql stable as $$
  select nullif(current_setting('doccheck.qa_user', true), '')::uuid
$$;

/** The latest validation run of each shipment. */
create view dc_latest_validations as
  select distinct on (shipment_id) shipment_id, id as validation_id, created_at, destination
  from validations order by shipment_id, created_at desc, id;

create view qa.shipments as
  select s.id, s.reference, s.destination, s.transport_mode, s.status, s.created_at,
    lv.created_at as validated_at
  from shipments s left join dc_latest_validations lv on lv.shipment_id = s.id
  where s.user_id = dc_qa_user();

create view qa.invoices as
  select i.shipment_id, i.invoice_number, i.invoice_date, i.po_number, i.currency, i.incoterm, i.incoterm_place, i.payment_terms,
    i.seller_id, i.seller_name, i.buyer_id, i.buyer_name, i.port_of_entry_name, i.port_of_entry_locode,
    i.invoice_total, i.invoice_total_currency, i.lines_total, i.line_count, i.package_count, i.gross_kg, i.net_kg, i.language
  from invoices i join current_documents cd on cd.document_id = i.document_id
  where i.user_id = dc_qa_user();

create view qa.invoice_lines as
  select l.shipment_id, i.invoice_number, i.invoice_date, i.seller_id, i.seller_name, l.line_no, l.sku, l.description,
    l.quantity, l.quantity_unit, l.unit_price, l.unit_price_currency as currency, l.line_total, l.computed_total,
    l.country_of_origin, l.hs_code, l.hs_digits, l.hs2, l.hs4, l.hs6, l.product_id
  from invoice_lines l join invoices i using (document_id) join current_documents cd on cd.document_id = l.document_id
  where l.user_id = dc_qa_user();

create view qa.packing_lists as
  select p.shipment_id, p.packing_list_number, p.invoice_ref, p.package_count, p.gross_kg, p.net_kg, p.volume_m3
  from packing_lists p join current_documents cd on cd.document_id = p.document_id
  where p.user_id = dc_qa_user();

create view qa.bills_of_lading as
  select b.shipment_id, b.bl_number, b.carrier_name, b.carrier_scac, b.vessel, b.voyage,
    b.port_of_loading_locode as port_of_loading, coalesce(b.port_of_loading_country, left(b.port_of_loading_locode, 2)) as port_of_loading_country,
    b.port_of_discharge_locode as port_of_discharge, coalesce(b.port_of_discharge_country, left(b.port_of_discharge_locode, 2)) as port_of_discharge_country,
    b.place_of_delivery_locode as place_of_delivery, b.total_packages, b.gross_kg, b.container_count, b.freight_terms,
    b.date_of_issue, b.shipped_on_board_date
  from bills_of_lading b join current_documents cd on cd.document_id = b.document_id
  where b.user_id = dc_qa_user();

create view qa.containers as
  select c.shipment_id, c.container_number, c.owner_code, c.seal, c.size_type, c.packages, c.gross_kg, c.volume_m3
  from bl_containers c join current_documents cd on cd.document_id = c.document_id
  where c.user_id = dc_qa_user();

create view qa.isf as
  select shipment_id, source, importer_of_record_number, country_of_origin, hts_code, hs6, stuffing_country
  from isf_details where user_id = dc_qa_user();

create view qa.parties as
  select id, name, country, tax_id, first_seen_at, last_seen_at from parties where user_id = dc_qa_user();

create view qa.products as
  select id, sku, description, hs_code, hs6, country_of_origin, unit, seller_id from products where user_id = dc_qa_user();

/** Findings of each shipment's latest validation, with the document type they point at and their status. */
create view qa.findings as
  select f.shipment_id, lv.created_at as validated_at, lv.destination, f.rule_id, f.severity, f.decided_by, f.message,
    coalesce(d.detected_type, case when f.evidence->0->>'documentId' ilike 'isf%' then 'ISF' end) as document_type,
    f.evidence->0->>'field' as field, coalesce(fs.status, 'open') as status,
    (select min(v2.created_at) from findings f2 join validations v2 on v2.id = f2.validation_id
      where f2.shipment_id = f.shipment_id and f2.fingerprint = f.fingerprint) as first_found_at
  from findings f
  join dc_latest_validations lv on lv.validation_id = f.validation_id
  join shipments s on s.id = f.shipment_id
  left join documents d on d.id::text = f.evidence->0->>'documentId'
  left join finding_status fs on fs.shipment_id = f.shipment_id and fs.fingerprint = f.fingerprint
  where s.user_id = dc_qa_user();

/** Requests for corrected documents and conversations with suppliers: when sent, when answered. */
create view qa.mail_requests as
  select t.id, t.shipment_id, t.party_id, p.name as party_name, t.kind, t.status, t.created_at, t.closed_at,
    (select min(coalesce(m.sent_at, m.created_at)) from mail_messages m where m.thread_id = t.id and m.direction = 'out') as sent_at,
    (select min(coalesce(m.received_at, m.created_at)) from mail_messages m where m.thread_id = t.id and m.direction = 'in') as first_reply_at
  from mail_threads t left join parties p on p.id = t.party_id
  where t.user_id = dc_qa_user();

-- The role checked queries run as: it can read the qa views and nothing else. Creating a role needs
-- CREATEROLE; where the database user lacks it (some hosted databases) the API still runs every
-- query read-only, with a timeout, behind the guard, and logs that the role is missing.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'doccheck_qa') then
    create role doccheck_qa nologin;
  end if;
  execute format('grant doccheck_qa to %I', current_user);
exception when insufficient_privilege then
  raise notice 'doccheck_qa role not created (%): Data Q&A runs without it', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'doccheck_qa') then
    revoke all on schema public from doccheck_qa;
    grant usage on schema qa to doccheck_qa;
    grant select on all tables in schema qa to doccheck_qa;
  end if;
exception when insufficient_privilege then
  raise notice 'doccheck_qa grants not applied (%)', sqlerrm;
end $$;

-- Cost assumptions -----------------------------------------------------------------------------------
-- Penalty amounts, delay days and demurrage per account; null means the defaults in
-- apps/api/src/insights/cost/penalties.ts. Validated by the API before it is saved.
create table analytics_settings (
  user_id uuid primary key references users (id) on delete cascade,
  cost jsonb,
  updated_at timestamptz not null default now()
);

-- Regulation changes -------------------------------------------------------------------------------
-- Each check downloads the corpus sources, splits them into passages (paragraphs) and compares their
-- hashes with the snapshot; the first check only records the snapshot.
create table regulation_checks (
  id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- scheduled | manual
  trigger text not null,
  documents int not null default 0,
  changes int not null default 0,
  -- Sources that could not be fetched: [{ id, error }]
  errors jsonb not null default '[]',
  baseline boolean not null default false
);

/** The current text of every passage, as of the latest check that read its document. */
create table regulation_passages (
  document_id text not null,
  ordinal int not null,
  section text not null,
  text text not null,
  hash text not null,
  url text not null,
  title text not null,
  effective_date text,
  check_id uuid references regulation_checks (id) on delete set null,
  primary key (document_id, ordinal)
);

create table regulation_changes (
  id uuid primary key,
  check_id uuid not null references regulation_checks (id) on delete cascade,
  document_id text not null,
  title text not null,
  url text not null,
  kind text not null check (kind in ('added', 'removed', 'changed')),
  section text not null,
  before_text text,
  after_text text,
  before_hash text,
  after_hash text,
  effective_before text,
  effective_after text,
  -- Rules that may cite the document: [{ destination, ruleId }]
  rules jsonb not null default '[]',
  detected_at timestamptz not null default now()
);
create index regulation_changes_detected_idx on regulation_changes (detected_at desc);

-- When each account last looked at the changes page: newer changes count as unread.
create table regulation_reads (
  user_id uuid primary key references users (id) on delete cascade,
  read_at timestamptz not null default now()
);
