-- Extracted data as tables (docs/DATA-MODEL.md). extractions.data stays the source of truth; these
-- tables are a projection of it, kept in sync by triggers: on extraction, correction, revert,
-- re-extraction (another type, or FAILED) and on the ISF filing. Deleting a document or a shipment
-- cascades. Parties and products are entities per user, found again across shipments by a
-- normalized key, so goods and companies can be grouped over time.
--
-- Every projected row keeps shipment_id and user_id (filters without joins) and an `extra` jsonb with
-- the keys the projection does not map, so a field added to a schema is kept before it gets a column.
-- When the projection changes, a migration replaces the dc_project_* function and runs
-- `select dc_reproject_all()`: no data is copied by hand.

-- Helpers ------------------------------------------------------------------------------------------

/** A decimal string as numeric, or null when it is not one (never a cast error). */
create function dc_num(v text) returns numeric language sql immutable as $$
  select case when v ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(v)::numeric end
$$;

create function dc_int(v text) returns int language sql immutable as $$
  select case when v ~ '^\s*-?[0-9]{1,9}\s*$' then trim(v)::int end
$$;

/** A YYYY-MM-DD string as date, or null (also for an impossible date like 2026-02-30). */
create function dc_date(v text) returns date language plpgsql stable as $$
begin
  if v ~ '^\d{4}-\d{2}-\d{2}$' then return v::date; end if;
  return null;
exception when others then
  return null;
end $$;

/** Non-empty trimmed text, or null. */
create function dc_text(v text) returns text language sql immutable as $$
  select nullif(trim(v), '')
$$;

/**
 * The key a company name is found again by: lower case, no accents or punctuation, no legal form.
 * "ACME Toys Co., Ltd." and "Acme Toys Co Ltd" are one party.
 */
create function dc_norm(v text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(regexp_replace(
    -- Accents before lower(), which leaves them alone under the C locale. Dots and apostrophes are
    -- dropped, so "S.p.A." is "spa" and "Co., Ltd." is "co ltd".
    lower(translate(coalesce(v, ''), 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãåéèêëíìîïóòôöõúùûüñç.''',
      'AAAAAAEEEEIIIIOOOOOUUUUNCaaaaaaeeeeiiiiooooouuuunc')),
    '[^a-z0-9]+', ' ', 'g'),
    '\m(co|company|corp|corporation|inc|incorporated|ltd|ltda|ltee|limited|llc|llp|plc|pvt|private|gmbh|kg|sa|sas|sarl|sl|slu|srl|sro|spa|sapi|bv|nv|ag|pte|pty|sdn|bhd|kk|oy|ab|cv|de|rl)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

/** Digits of an HS code: "9503.00.0090" -> "9503000090". */
create function dc_hs(v text) returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g'), '')
$$;

/** A jsonb array, or [] for anything else (null, an object, a string). */
create function dc_array(v jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end
$$;

/** The keys of `v` not in `known`, or null when there are none. */
create function dc_extra(v jsonb, known text[]) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(v) = 'object' then nullif(v - known, '{}'::jsonb) end
$$;

-- Entities -----------------------------------------------------------------------------------------

/** A company as the user's documents name it: seller, buyer, shipper, carrier's customer... */
create table parties (
  id uuid primary key,
  user_id uuid references users (id) on delete cascade,
  key text not null,
  -- As printed the last time it was seen.
  name text not null,
  country text,
  tax_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique nulls not distinct (user_id, key)
);

/** A product: by SKU when the document gives one, else by its normalized description. */
create table products (
  id uuid primary key,
  user_id uuid references users (id) on delete cascade,
  key text not null,
  sku text,
  description text not null,
  hs_code text,
  hs6 text,
  country_of_origin text,
  unit text,
  -- The seller it was last bought from.
  seller_id uuid references parties (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique nulls not distinct (user_id, key)
);
create index products_hs6_idx on products (user_id, hs6);

create function dc_party(p_user uuid, p jsonb) returns uuid language plpgsql as $$
declare
  v_name text := dc_text(p->>'name');
  v_id uuid;
begin
  if jsonb_typeof(p) <> 'object' or v_name is null then return null; end if;
  insert into parties as t (id, user_id, key, name, country, tax_id)
  values (gen_random_uuid(), p_user, coalesce(dc_norm(v_name), lower(v_name)), v_name, dc_text(p->'address'->>'country'), dc_text(p->>'taxId'))
  on conflict (user_id, key) do update
    set name = excluded.name, country = coalesce(excluded.country, t.country), tax_id = coalesce(excluded.tax_id, t.tax_id), last_seen_at = now()
  returning id into v_id;
  return v_id;
end $$;

create function dc_product(p_user uuid, p_seller uuid, p_sku text, p_description text, p_hs text, p_origin text, p_unit text) returns uuid language plpgsql as $$
declare
  v_sku text := dc_text(p_sku);
  v_desc text := dc_text(p_description);
  v_key text;
  v_id uuid;
begin
  v_key := case when v_sku is not null then 'sku:' || upper(v_sku) when v_desc is not null then 'desc:' || coalesce(dc_norm(v_desc), lower(v_desc)) end;
  if v_key is null then return null; end if;
  insert into products as t (id, user_id, key, sku, description, hs_code, hs6, country_of_origin, unit, seller_id)
  values (gen_random_uuid(), p_user, v_key, v_sku, coalesce(v_desc, v_sku), dc_text(p_hs), left(dc_hs(p_hs), 6), dc_text(p_origin), dc_text(p_unit), p_seller)
  on conflict (user_id, key) do update set
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

-- Parties as each document prints them ------------------------------------------------------------

create table document_parties (
  id bigserial primary key,
  -- Null for an ISF filed as JSON (it has no document).
  document_id uuid references documents (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  source text not null check (source in ('COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'ISF')),
  -- seller, buyer, consignee, exporter, originator, shipper, notify, manufacturer, ship_to, consolidator
  role text not null,
  party_id uuid references parties (id) on delete set null,
  name text not null,
  address_lines text[] not null default '{}',
  city text,
  region text,
  postal_code text,
  country text,
  tax_id text,
  contact_name text,
  contact_email text,
  contact_phone text,
  extra jsonb
);
create index document_parties_document_idx on document_parties (document_id);
create index document_parties_shipment_idx on document_parties (shipment_id, source);
create index document_parties_party_idx on document_parties (party_id, role);

create function dc_document_party(p_doc uuid, p_ship uuid, p_user uuid, p_source text, p_role text, p jsonb) returns uuid language plpgsql as $$
declare
  v_id uuid := dc_party(p_user, p);
begin
  if v_id is null then return null; end if;
  insert into document_parties (document_id, shipment_id, user_id, source, role, party_id, name, address_lines, city, region, postal_code,
    country, tax_id, contact_name, contact_email, contact_phone, extra)
  values (p_doc, p_ship, p_user, p_source, p_role, v_id, dc_text(p->>'name'),
    array(select jsonb_array_elements_text(dc_array(p->'address'->'lines'))),
    dc_text(p->'address'->>'city'), dc_text(p->'address'->>'region'), dc_text(p->'address'->>'postalCode'), dc_text(p->'address'->>'country'),
    dc_text(p->>'taxId'), dc_text(p->'contact'->>'name'), dc_text(p->'contact'->>'email'), dc_text(p->'contact'->>'phone'),
    dc_extra(p, array['name', 'address', 'taxId', 'contact']));
  return v_id;
end $$;

-- Commercial invoice -------------------------------------------------------------------------------

create table invoices (
  document_id uuid primary key references documents (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  invoice_number text,
  invoice_date date,
  po_number text,
  shipment_date date,
  currency text,
  seller_id uuid references parties (id) on delete set null,
  seller_name text,
  buyer_id uuid references parties (id) on delete set null,
  buyer_name text,
  consignee_id uuid references parties (id) on delete set null,
  exporter_id uuid references parties (id) on delete set null,
  originator_id uuid references parties (id) on delete set null,
  port_of_entry_name text,
  port_of_entry_locode text,
  port_of_entry_country text,
  transport_mode text,
  place_of_shipment_name text,
  place_of_shipment_locode text,
  place_of_shipment_country text,
  country_of_transshipment text,
  incoterm text,
  incoterm_place text,
  payment_terms text,
  package_count int,
  gross_kg numeric,
  gross_raw_value numeric,
  gross_raw_unit text,
  net_kg numeric,
  net_raw_value numeric,
  net_raw_unit text,
  invoice_total numeric,
  invoice_total_currency text,
  freight numeric,
  freight_currency text,
  insurance numeric,
  insurance_currency text,
  packing_charge numeric,
  packing_charge_currency text,
  responsible_person text,
  customs_ruling text,
  language text,
  line_count int not null default 0,
  -- Sum of the lines in the invoice currency (lines in another currency left out), to compare with invoice_total.
  lines_total numeric,
  extracted_at timestamptz,
  extra jsonb
);
create index invoices_shipment_idx on invoices (shipment_id);
create index invoices_user_idx on invoices (user_id, invoice_date);
create index invoices_number_idx on invoices (user_id, invoice_number);
create index invoices_seller_idx on invoices (seller_id);
create index invoices_buyer_idx on invoices (buyer_id);

create table invoice_lines (
  document_id uuid not null references invoices (document_id) on delete cascade,
  -- Position in the document (1-based); line_no is the number the invoice prints.
  idx int not null,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  line_no int,
  sku text,
  description text,
  marks_and_numbers text,
  quantity numeric,
  quantity_unit text,
  unit_price numeric,
  unit_price_currency text,
  line_total numeric,
  line_total_currency text,
  -- quantity × unit price, to spot a line whose printed total does not add up.
  computed_total numeric,
  country_of_origin text,
  hs_code text,
  hs_digits text,
  hs2 text,
  hs4 text,
  hs6 text,
  product_id uuid references products (id) on delete set null,
  extra jsonb,
  primary key (document_id, idx)
);
create index invoice_lines_user_idx on invoice_lines (user_id);
create index invoice_lines_shipment_idx on invoice_lines (shipment_id);
create index invoice_lines_hs_idx on invoice_lines (user_id, hs_digits text_pattern_ops);
create index invoice_lines_hs6_idx on invoice_lines (user_id, hs6);
create index invoice_lines_origin_idx on invoice_lines (user_id, country_of_origin);
create index invoice_lines_product_idx on invoice_lines (product_id);

/** Charges and discounts of an invoice, one row each: freight, insurance, packing, discount. */
create table invoice_adjustments (
  document_id uuid not null references invoices (document_id) on delete cascade,
  idx int not null,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('freight', 'insurance', 'packing', 'discount')),
  description text,
  amount numeric,
  currency text,
  primary key (document_id, idx)
);

-- Packing list -------------------------------------------------------------------------------------

create table packing_lists (
  document_id uuid primary key references documents (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  packing_list_number text,
  invoice_ref text,
  seller_id uuid references parties (id) on delete set null,
  consignee_id uuid references parties (id) on delete set null,
  package_count int,
  net_kg numeric,
  net_raw_value numeric,
  net_raw_unit text,
  gross_kg numeric,
  gross_raw_value numeric,
  gross_raw_unit text,
  volume_m3 numeric,
  group_count int not null default 0,
  extracted_at timestamptz,
  extra jsonb
);
create index packing_lists_shipment_idx on packing_lists (shipment_id);
create index packing_lists_user_idx on packing_lists (user_id);

/** A group of identical packages: "1-60, 60 CTN". */
create table packing_packages (
  document_id uuid not null references packing_lists (document_id) on delete cascade,
  idx int not null,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  range_text text,
  first_no int,
  last_no int,
  count int,
  package_type text,
  marks text,
  net_kg numeric,
  net_raw_value numeric,
  net_raw_unit text,
  gross_kg numeric,
  gross_raw_value numeric,
  gross_raw_unit text,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  -- One package's volume from its dimensions; × count for the group.
  unit_volume_m3 numeric,
  extra jsonb,
  primary key (document_id, idx)
);

create table packing_contents (
  document_id uuid not null references packing_lists (document_id) on delete cascade,
  package_idx int not null,
  idx int not null,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  sku text,
  description text,
  quantity numeric,
  quantity_unit text,
  product_id uuid references products (id) on delete set null,
  extra jsonb,
  primary key (document_id, package_idx, idx)
);
create index packing_contents_product_idx on packing_contents (product_id);

-- Bill of lading -----------------------------------------------------------------------------------

create table bills_of_lading (
  document_id uuid primary key references documents (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  bl_number text,
  bl_issuer text,
  bl_form text,
  booking_number text,
  carrier_name text,
  carrier_scac text,
  shipper_id uuid references parties (id) on delete set null,
  consignee_id uuid references parties (id) on delete set null,
  notify_id uuid references parties (id) on delete set null,
  vessel text,
  voyage text,
  place_of_receipt_name text,
  place_of_receipt_locode text,
  place_of_receipt_country text,
  port_of_loading_name text,
  port_of_loading_locode text,
  port_of_loading_country text,
  port_of_discharge_name text,
  port_of_discharge_locode text,
  port_of_discharge_country text,
  place_of_delivery_name text,
  place_of_delivery_locode text,
  place_of_delivery_country text,
  container_count int not null default 0,
  total_packages int,
  gross_kg numeric,
  gross_raw_value numeric,
  gross_raw_unit text,
  marks_and_numbers text,
  cargo_description text,
  freight_terms text,
  place_of_issue text,
  date_of_issue date,
  shipped_on_board_date date,
  -- Invoice or PO numbers the B/L quotes.
  "references" text[] not null default '{}',
  extracted_at timestamptz,
  extra jsonb
);
create index bills_of_lading_shipment_idx on bills_of_lading (shipment_id);
create index bills_of_lading_user_idx on bills_of_lading (user_id, bl_number);
create index bills_of_lading_route_idx on bills_of_lading (user_id, port_of_loading_locode, port_of_discharge_locode);
create index bills_of_lading_carrier_idx on bills_of_lading (user_id, carrier_scac);

create table bl_containers (
  document_id uuid not null references bills_of_lading (document_id) on delete cascade,
  idx int not null,
  shipment_id uuid not null references shipments (id) on delete cascade,
  user_id uuid,
  container_number text,
  -- ISO 6346 owner code (first 4 letters): the box's owner or lessor.
  owner_code text,
  seal text,
  size_type text,
  packages int,
  gross_kg numeric,
  gross_raw_value numeric,
  gross_raw_unit text,
  volume_m3 numeric,
  extra jsonb,
  primary key (document_id, idx)
);
create index bl_containers_number_idx on bl_containers (user_id, container_number);

-- ISF ----------------------------------------------------------------------------------------------

create table isf_details (
  shipment_id uuid primary key references shipments (id) on delete cascade,
  user_id uuid,
  document_id uuid references documents (id) on delete set null,
  source text not null,
  importer_of_record_number text,
  consignee_number text,
  country_of_origin text,
  hts_code text,
  hts_digits text,
  hs6 text,
  seller_id uuid references parties (id) on delete set null,
  buyer_id uuid references parties (id) on delete set null,
  manufacturer_id uuid references parties (id) on delete set null,
  ship_to_id uuid references parties (id) on delete set null,
  consolidator_id uuid references parties (id) on delete set null,
  stuffing_address_lines text[] not null default '{}',
  stuffing_city text,
  stuffing_region text,
  stuffing_postal_code text,
  stuffing_country text,
  updated_at timestamptz,
  extra jsonb
);

-- Projection ---------------------------------------------------------------------------------------

create function dc_project_invoice(p_doc uuid, p_ship uuid, p_user uuid, v jsonb, p_at timestamptz) returns void language plpgsql as $$
declare
  v_seller uuid := dc_document_party(p_doc, p_ship, p_user, 'COMMERCIAL_INVOICE', 'seller', v->'seller');
  v_buyer uuid := dc_document_party(p_doc, p_ship, p_user, 'COMMERCIAL_INVOICE', 'buyer', v->'buyer');
  v_currency text := dc_text(v->>'currency');
begin
  insert into invoices (document_id, shipment_id, user_id, invoice_number, invoice_date, po_number, shipment_date, currency,
    seller_id, seller_name, buyer_id, buyer_name, consignee_id, exporter_id, originator_id,
    port_of_entry_name, port_of_entry_locode, port_of_entry_country, transport_mode,
    place_of_shipment_name, place_of_shipment_locode, place_of_shipment_country, country_of_transshipment,
    incoterm, incoterm_place, payment_terms, package_count,
    gross_kg, gross_raw_value, gross_raw_unit, net_kg, net_raw_value, net_raw_unit,
    invoice_total, invoice_total_currency, freight, freight_currency, insurance, insurance_currency, packing_charge, packing_charge_currency,
    responsible_person, customs_ruling, language, extracted_at, extra)
  values (p_doc, p_ship, p_user, dc_text(v->>'invoiceNumber'), dc_date(v->>'invoiceDate'), dc_text(v->>'poNumber'), dc_date(v->>'shipmentDate'), v_currency,
    v_seller, dc_text(v->'seller'->>'name'), v_buyer, dc_text(v->'buyer'->>'name'),
    dc_document_party(p_doc, p_ship, p_user, 'COMMERCIAL_INVOICE', 'consignee', v->'consignee'),
    dc_document_party(p_doc, p_ship, p_user, 'COMMERCIAL_INVOICE', 'exporter', v->'exporter'),
    dc_document_party(p_doc, p_ship, p_user, 'COMMERCIAL_INVOICE', 'originator', v->'originator'),
    dc_text(v->'portOfEntry'->>'name'), dc_text(v->'portOfEntry'->>'unLocode'), dc_text(v->'portOfEntry'->>'country'), dc_text(v->'transport'->>'mode'),
    dc_text(v->'transport'->'placeOfShipment'->>'name'), dc_text(v->'transport'->'placeOfShipment'->>'unLocode'), dc_text(v->'transport'->'placeOfShipment'->>'country'),
    dc_text(v->>'countryOfTransshipment'),
    dc_text(v->'incoterm'->>'code'), dc_text(v->'incoterm'->>'place'), dc_text(v->>'paymentTerms'), dc_int(v->>'packageCount'),
    dc_num(v->'grossWeight'->>'kg'), dc_num(v->'grossWeight'->'raw'->>'value'), dc_text(v->'grossWeight'->'raw'->>'unit'),
    dc_num(v->'netWeight'->>'kg'), dc_num(v->'netWeight'->'raw'->>'value'), dc_text(v->'netWeight'->'raw'->>'unit'),
    dc_num(v->'invoiceTotal'->>'amount'), dc_text(v->'invoiceTotal'->>'currency'),
    dc_num(v->'charges'->'freight'->>'amount'), dc_text(v->'charges'->'freight'->>'currency'),
    dc_num(v->'charges'->'insurance'->>'amount'), dc_text(v->'charges'->'insurance'->>'currency'),
    dc_num(v->'charges'->'packing'->>'amount'), dc_text(v->'charges'->'packing'->>'currency'),
    dc_text(v->>'responsiblePerson'), dc_text(v->>'customsRuling'), dc_text(v->>'language'), p_at,
    dc_extra(v, array['invoiceNumber', 'invoiceDate', 'poNumber', 'seller', 'buyer', 'consignee', 'exporter', 'originator', 'shipmentDate',
      'portOfEntry', 'transport', 'countryOfTransshipment', 'incoterm', 'paymentTerms', 'currency', 'packageCount', 'lines', 'grossWeight',
      'netWeight', 'invoiceTotal', 'charges', 'discounts', 'responsiblePerson', 'customsRuling', 'language']));

  insert into invoice_lines (document_id, idx, shipment_id, user_id, line_no, sku, description, marks_and_numbers, quantity, quantity_unit,
    unit_price, unit_price_currency, line_total, line_total_currency, computed_total, country_of_origin, hs_code, hs_digits, hs2, hs4, hs6, product_id, extra)
  select p_doc, l.idx, p_ship, p_user, dc_int(l.line->>'lineNo'), dc_text(l.line->>'sku'), dc_text(l.line->>'description'), dc_text(l.line->>'marksAndNumbers'),
    dc_num(l.line->'quantity'->>'value'), dc_text(l.line->'quantity'->>'unit'),
    dc_num(l.line->'unitPrice'->>'amount'), dc_text(l.line->'unitPrice'->>'currency'),
    dc_num(l.line->'lineTotal'->>'amount'), dc_text(l.line->'lineTotal'->>'currency'),
    dc_num(l.line->'quantity'->>'value') * dc_num(l.line->'unitPrice'->>'amount'),
    dc_text(l.line->>'countryOfOrigin'), dc_text(l.line->>'hsCode'), h.d,
    case when length(h.d) >= 2 then left(h.d, 2) end, case when length(h.d) >= 4 then left(h.d, 4) end, case when length(h.d) >= 6 then left(h.d, 6) end,
    dc_product(p_user, v_seller, l.line->>'sku', l.line->>'description', l.line->>'hsCode', l.line->>'countryOfOrigin', l.line->'quantity'->>'unit'),
    dc_extra(l.line, array['lineNo', 'sku', 'description', 'marksAndNumbers', 'quantity', 'unitPrice', 'lineTotal', 'countryOfOrigin', 'hsCode'])
  from jsonb_array_elements(dc_array(v->'lines')) with ordinality l(line, idx)
  cross join lateral (select dc_hs(l.line->>'hsCode') as d) h
  where jsonb_typeof(l.line) = 'object';

  insert into invoice_adjustments (document_id, idx, shipment_id, user_id, kind, description, amount, currency)
  select p_doc, row_number() over (order by a.ord, a.sub), p_ship, p_user, a.kind, a.description, dc_num(a.m->>'amount'), dc_text(a.m->>'currency')
  from (
    select 1 as ord, c.sub, c.kind, null::text as description, v->'charges'->c.kind as m
    from (values (1, 'freight'), (2, 'insurance'), (3, 'packing')) c(sub, kind)
    where jsonb_typeof(v->'charges'->c.kind) = 'object'
    union all
    select 2, d.idx, 'discount', dc_text(d.x->>'description'), d.x->'amount'
    from jsonb_array_elements(dc_array(v->'discounts')) with ordinality d(x, idx)
    where jsonb_typeof(d.x) = 'object'
  ) a;

  update invoices set
    line_count = (select count(*) from invoice_lines where document_id = p_doc),
    lines_total = (select sum(line_total) from invoice_lines where document_id = p_doc and line_total_currency = v_currency)
  where document_id = p_doc;
end $$;

create function dc_project_packing_list(p_doc uuid, p_ship uuid, p_user uuid, v jsonb, p_at timestamptz) returns void language plpgsql as $$
declare
  v_seller uuid := dc_document_party(p_doc, p_ship, p_user, 'PACKING_LIST', 'seller', v->'seller');
  t jsonb := v->'totals';
begin
  insert into packing_lists (document_id, shipment_id, user_id, packing_list_number, invoice_ref, seller_id, consignee_id, package_count,
    net_kg, net_raw_value, net_raw_unit, gross_kg, gross_raw_value, gross_raw_unit, volume_m3, group_count, extracted_at, extra)
  values (p_doc, p_ship, p_user, dc_text(v->>'packingListNumber'), dc_text(v->>'invoiceRef'), v_seller,
    dc_document_party(p_doc, p_ship, p_user, 'PACKING_LIST', 'consignee', v->'consignee'),
    dc_int(t->>'packageCount'),
    dc_num(t->'netWeight'->>'kg'), dc_num(t->'netWeight'->'raw'->>'value'), dc_text(t->'netWeight'->'raw'->>'unit'),
    dc_num(t->'grossWeight'->>'kg'), dc_num(t->'grossWeight'->'raw'->>'value'), dc_text(t->'grossWeight'->'raw'->>'unit'),
    dc_num(t->>'volumeM3'), jsonb_array_length(dc_array(v->'packages')), p_at,
    dc_extra(v, array['packingListNumber', 'invoiceRef', 'seller', 'consignee', 'packages', 'totals']));

  insert into packing_packages (document_id, idx, shipment_id, user_id, range_text, first_no, last_no, count, package_type, marks,
    net_kg, net_raw_value, net_raw_unit, gross_kg, gross_raw_value, gross_raw_unit, length_cm, width_cm, height_cm, unit_volume_m3, extra)
  select p_doc, g.idx, p_ship, p_user, dc_text(g.x->>'range'),
    dc_int(substring(g.x->>'range' from '^\s*(\d+)')), dc_int(coalesce(substring(g.x->>'range' from '(\d+)\s*$'), substring(g.x->>'range' from '^\s*(\d+)'))),
    dc_int(g.x->>'count'), dc_text(g.x->>'type'), dc_text(g.x->>'marks'),
    dc_num(g.x->'netWeight'->>'kg'), dc_num(g.x->'netWeight'->'raw'->>'value'), dc_text(g.x->'netWeight'->'raw'->>'unit'),
    dc_num(g.x->'grossWeight'->>'kg'), dc_num(g.x->'grossWeight'->'raw'->>'value'), dc_text(g.x->'grossWeight'->'raw'->>'unit'),
    dc_num(g.x->'dimensionsCm'->>0), dc_num(g.x->'dimensionsCm'->>1), dc_num(g.x->'dimensionsCm'->>2),
    round(dc_num(g.x->'dimensionsCm'->>0) * dc_num(g.x->'dimensionsCm'->>1) * dc_num(g.x->'dimensionsCm'->>2) / 1000000, 6),
    dc_extra(g.x, array['range', 'count', 'type', 'marks', 'contents', 'netWeight', 'grossWeight', 'dimensionsCm'])
  from jsonb_array_elements(dc_array(v->'packages')) with ordinality g(x, idx)
  where jsonb_typeof(g.x) = 'object';

  insert into packing_contents (document_id, package_idx, idx, shipment_id, user_id, sku, description, quantity, quantity_unit, product_id, extra)
  select p_doc, g.idx, c.idx, p_ship, p_user, dc_text(c.x->>'sku'), dc_text(c.x->>'description'),
    dc_num(c.x->'quantity'->>'value'), dc_text(c.x->'quantity'->>'unit'),
    dc_product(p_user, v_seller, c.x->>'sku', c.x->>'description', null, null, c.x->'quantity'->>'unit'),
    dc_extra(c.x, array['sku', 'description', 'quantity'])
  from jsonb_array_elements(dc_array(v->'packages')) with ordinality g(x, idx)
  cross join lateral jsonb_array_elements(dc_array(g.x->'contents')) with ordinality c(x, idx)
  where jsonb_typeof(g.x) = 'object' and jsonb_typeof(c.x) = 'object';
end $$;

create function dc_project_bill_of_lading(p_doc uuid, p_ship uuid, p_user uuid, v jsonb, p_at timestamptz) returns void language plpgsql as $$
begin
  insert into bills_of_lading (document_id, shipment_id, user_id, bl_number, bl_issuer, bl_form, booking_number, carrier_name, carrier_scac,
    shipper_id, consignee_id, notify_id, vessel, voyage,
    place_of_receipt_name, place_of_receipt_locode, place_of_receipt_country,
    port_of_loading_name, port_of_loading_locode, port_of_loading_country,
    port_of_discharge_name, port_of_discharge_locode, port_of_discharge_country,
    place_of_delivery_name, place_of_delivery_locode, place_of_delivery_country,
    container_count, total_packages, gross_kg, gross_raw_value, gross_raw_unit, marks_and_numbers, cargo_description, freight_terms,
    place_of_issue, date_of_issue, shipped_on_board_date, "references", extracted_at, extra)
  values (p_doc, p_ship, p_user, dc_text(v->>'blNumber'), dc_text(v->'blType'->>'issuer'), dc_text(v->'blType'->>'form'), dc_text(v->>'bookingNumber'),
    dc_text(v->'carrier'->>'name'), dc_text(v->'carrier'->>'scac'),
    dc_document_party(p_doc, p_ship, p_user, 'BILL_OF_LADING', 'shipper', v->'shipper'),
    dc_document_party(p_doc, p_ship, p_user, 'BILL_OF_LADING', 'consignee', v->'consignee'),
    dc_document_party(p_doc, p_ship, p_user, 'BILL_OF_LADING', 'notify', v->'notifyParty'),
    dc_text(v->>'vessel'), dc_text(v->>'voyage'),
    dc_text(v->'placeOfReceipt'->>'name'), dc_text(v->'placeOfReceipt'->>'unLocode'), dc_text(v->'placeOfReceipt'->>'country'),
    dc_text(v->'portOfLoading'->>'name'), dc_text(v->'portOfLoading'->>'unLocode'), dc_text(v->'portOfLoading'->>'country'),
    dc_text(v->'portOfDischarge'->>'name'), dc_text(v->'portOfDischarge'->>'unLocode'), dc_text(v->'portOfDischarge'->>'country'),
    dc_text(v->'placeOfDelivery'->>'name'), dc_text(v->'placeOfDelivery'->>'unLocode'), dc_text(v->'placeOfDelivery'->>'country'),
    jsonb_array_length(dc_array(v->'containers')), dc_int(v->>'totalPackages'),
    dc_num(v->'totalGrossWeight'->>'kg'), dc_num(v->'totalGrossWeight'->'raw'->>'value'), dc_text(v->'totalGrossWeight'->'raw'->>'unit'),
    dc_text(v->>'marksAndNumbers'), dc_text(v->>'cargoDescription'), dc_text(v->>'freightTerms'),
    dc_text(v->>'placeOfIssue'), dc_date(v->>'dateOfIssue'), dc_date(v->>'shippedOnBoardDate'),
    array(select r from jsonb_array_elements_text(dc_array(v->'references')) r where dc_text(r) is not null), p_at,
    dc_extra(v, array['blNumber', 'blType', 'bookingNumber', 'carrier', 'shipper', 'consignee', 'notifyParty', 'vessel', 'voyage', 'placeOfReceipt',
      'portOfLoading', 'portOfDischarge', 'placeOfDelivery', 'containers', 'totalPackages', 'totalGrossWeight', 'marksAndNumbers', 'cargoDescription',
      'freightTerms', 'placeOfIssue', 'dateOfIssue', 'shippedOnBoardDate', 'references']));

  insert into bl_containers (document_id, idx, shipment_id, user_id, container_number, owner_code, seal, size_type, packages,
    gross_kg, gross_raw_value, gross_raw_unit, volume_m3, extra)
  select p_doc, c.idx, p_ship, p_user, dc_text(c.x->>'number'), left(dc_text(c.x->>'number'), 4), dc_text(c.x->>'seal'), dc_text(c.x->>'type'),
    dc_int(c.x->>'packages'), dc_num(c.x->'grossWeight'->>'kg'), dc_num(c.x->'grossWeight'->'raw'->>'value'), dc_text(c.x->'grossWeight'->'raw'->>'unit'),
    dc_num(c.x->>'volumeM3'), dc_extra(c.x, array['number', 'seal', 'type', 'packages', 'grossWeight', 'volumeM3'])
  from jsonb_array_elements(dc_array(v->'containers')) with ordinality c(x, idx)
  where jsonb_typeof(c.x) = 'object';
end $$;

/** Rebuilds the rows of one document from its current extraction (none unless EXTRACTED). */
create function dc_project_document(p_doc uuid) returns void language plpgsql as $$
declare
  r record;
begin
  delete from invoices where document_id = p_doc;
  delete from packing_lists where document_id = p_doc;
  delete from bills_of_lading where document_id = p_doc;
  delete from document_parties where document_id = p_doc and source <> 'ISF';

  select doc.shipment_id, doc.detected_type, doc.status, e.data, e.created_at, s.user_id into r
  from documents doc join extractions e on e.document_id = doc.id join shipments s on s.id = doc.shipment_id
  where doc.id = p_doc;
  if not found or r.status <> 'EXTRACTED' or jsonb_typeof(r.data) is distinct from 'object' then return; end if;

  case r.detected_type
    when 'COMMERCIAL_INVOICE' then perform dc_project_invoice(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    when 'PACKING_LIST' then perform dc_project_packing_list(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    when 'BILL_OF_LADING' then perform dc_project_bill_of_lading(p_doc, r.shipment_id, r.user_id, r.data, r.created_at);
    else null; -- ISF documents are projected from isf_filings, which is what validation uses.
  end case;
end $$;

/** Rebuilds the ISF rows of a shipment from its filing (JSON or PDF). */
create function dc_project_isf(p_ship uuid) returns void language plpgsql as $$
declare
  r record;
  v jsonb;
  d text;
begin
  delete from isf_details where shipment_id = p_ship;
  delete from document_parties where shipment_id = p_ship and source = 'ISF';

  select i.data, i.document_id, i.source, i.updated_at, s.user_id into r
  from isf_filings i join shipments s on s.id = i.shipment_id where i.shipment_id = p_ship;
  if not found or jsonb_typeof(r.data) is distinct from 'object' then return; end if;
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
end $$;

/** Rebuilds every projected row. For a migration that changes the projection. */
create function dc_reproject_all() returns void language plpgsql as $$
declare
  x uuid;
begin
  for x in select id from documents loop perform dc_project_document(x); end loop;
  for x in select shipment_id from isf_filings loop perform dc_project_isf(x); end loop;
  -- Entities no document names any more (their key changed, or the documents are gone).
  delete from products p where not exists (select 1 from invoice_lines where product_id = p.id)
    and not exists (select 1 from packing_contents where product_id = p.id);
  delete from parties p where not exists (select 1 from document_parties where party_id = p.id);
end $$;

-- Triggers -----------------------------------------------------------------------------------------

create function dc_on_extraction() returns trigger language plpgsql as $$
begin
  perform dc_project_document(new.document_id);
  return null;
end $$;
create trigger extractions_project after insert or update of data on extractions
  for each row execute function dc_on_extraction();

create function dc_on_document() returns trigger language plpgsql as $$
begin
  perform dc_project_document(new.id);
  return null;
end $$;
create trigger documents_project after update of status, detected_type on documents
  for each row when (old.status is distinct from new.status or old.detected_type is distinct from new.detected_type)
  execute function dc_on_document();

create function dc_on_isf() returns trigger language plpgsql as $$
begin
  perform dc_project_isf(coalesce(new.shipment_id, old.shipment_id));
  return null;
end $$;
create trigger isf_filings_project after insert or update on isf_filings
  for each row execute function dc_on_isf();
create trigger isf_filings_unproject after delete on isf_filings
  for each row execute function dc_on_isf();

-- A shipment that changes owner takes its rows to the new owner's parties and products.
create function dc_on_shipment_owner() returns trigger language plpgsql as $$
declare
  x uuid;
begin
  for x in select id from documents where shipment_id = new.id loop perform dc_project_document(x); end loop;
  perform dc_project_isf(new.id);
  return null;
end $$;
create trigger shipments_project after update of user_id on shipments
  for each row when (old.user_id is distinct from new.user_id) execute function dc_on_shipment_owner();

-- Views --------------------------------------------------------------------------------------------

/** The document of each type validation uses: the latest one extracted. */
create view current_documents as
  select distinct on (doc.shipment_id, doc.detected_type) doc.shipment_id, doc.detected_type, doc.id as document_id
  from documents doc join extractions e on e.document_id = doc.id
  where doc.status = 'EXTRACTED' and e.data is not null
  order by doc.shipment_id, doc.detected_type, doc.created_at desc;

select dc_reproject_all();
