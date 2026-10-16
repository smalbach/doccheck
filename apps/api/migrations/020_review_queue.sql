-- Human review queue and supplier learning.
--
-- field_confidence: how sure the extraction is of each value of a document (FieldConfidence[] from
-- packages/extraction/src/confidence.ts: JSON pointer, value, what was printed, 0-1 confidence,
-- reasons, where it is printed). Written with every extraction; a field under the threshold
-- (REVIEW_THRESHOLD, admin setting) goes to the review queue until someone accepts or corrects it.
create table field_confidence (
  document_id uuid primary key references documents (id) on delete cascade,
  fields jsonb not null default '[]',
  computed_at timestamptz not null default now()
);

-- A person's check of one low-confidence value: accepted as read, or corrected (the correction itself
-- and its audit trail are in corrections). Re-extracting the document clears them.
create table field_reviews (
  document_id uuid not null references documents (id) on delete cascade,
  path text not null,
  status text not null check (status in ('accepted', 'corrected')),
  user_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (document_id, path)
);

-- Values corrected on a supplier's documents, given to the model as examples on the next documents
-- from that supplier (SUPPLIER_LEARNING). One example per account, supplier, document type and field:
-- a newer correction of the same field replaces the older one.
create table supplier_examples (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  -- Normalized supplier name (supplierKey in supplier-examples.ts): "ACME TOYS".
  supplier_key text not null,
  supplier_name text not null,
  document_type text not null,
  -- Answer field ("netWeight.value"), the model's value, the corrected value, the printed line.
  field text not null,
  model_value text,
  correct_value text,
  line text,
  document_id uuid references documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, supplier_key, document_type, field)
);
create index supplier_examples_user_idx on supplier_examples (user_id, supplier_key, created_at desc);
