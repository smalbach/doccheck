-- Live progress of extractions and validations (docs/PROGRESS-EVENTS.md). Each row is one event,
-- streamed over SSE as it is stored (Postgres NOTIFY on channel doccheck_progress) and replayed
-- after Last-Event-ID on reconnect. Rows older than 7 days are pruned by the API.

create table progress_events (
  id bigserial primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  -- Owner of the shipment when the event was stored, for the user-wide stream.
  user_id uuid references users (id) on delete cascade,
  document_id uuid references documents (id) on delete cascade,
  -- One extraction of a document, or one validation (then the validation's id).
  run_id uuid not null,
  kind text not null check (kind in ('extraction', 'validation')),
  stage text not null,
  status text not null check (status in ('started', 'progress', 'done', 'failed', 'skipped')),
  at timestamptz not null default now(),
  duration_ms integer,
  detail jsonb not null default '{}'
);
create index progress_events_shipment_idx on progress_events (shipment_id, id);
create index progress_events_user_idx on progress_events (user_id, id);
create index progress_events_at_idx on progress_events (at);
