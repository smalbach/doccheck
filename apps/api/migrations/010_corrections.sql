-- Values corrected by hand in an extracted document, with an audit trail.
-- extractions.data stays the current document (corrected), so validation reads it as before;
-- model_data keeps what the model read, filled on the first correction, so it can be restored.
-- Re-extracting a document replaces both and deletes its corrections.

alter table extractions add column model_data jsonb;

create table corrections (
  id uuid primary key,
  document_id uuid not null references documents (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  -- JSON pointer into the document: "/lines/0/quantity/value".
  path text not null,
  -- null when the value was absent (an optional field added) or is removed.
  old_value jsonb,
  new_value jsonb,
  -- 'edit' by hand, or 'revert' back to the model's value.
  action text not null default 'edit' check (action in ('edit', 'revert')),
  created_at timestamptz not null default now()
);
create index corrections_document_idx on corrections (document_id, created_at);
