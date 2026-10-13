-- Extraction runs in a queue: a document exists before its type and page count are known.

alter table documents
  add column status text not null default 'EXTRACTED' check (status in ('QUEUED', 'EXTRACTING', 'EXTRACTED', 'FAILED')),
  add column error text,
  alter column page_count set default 0,
  alter column detected_type set default 'UNKNOWN',
  alter column type_confidence set default 0;

create index documents_status_idx on documents (shipment_id, status);
