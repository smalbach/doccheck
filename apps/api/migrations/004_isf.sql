-- Importer Security Filing (10+2) per shipment. It is an electronic filing, not a PDF, so it is
-- stored as JSON (validated against the Isf schema) instead of going through extraction.

create table isf_filings (
  shipment_id uuid primary key references shipments (id) on delete cascade,
  data jsonb not null,
  source text not null,
  updated_at timestamptz not null default now()
);
