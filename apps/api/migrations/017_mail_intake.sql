-- Documents by email (docs/MESSAGING.md): a message with PDFs sent to a user's intake address (the
-- mailbox with "+in-<token>"), or from the user's own verified address, becomes a shipment that is
-- extracted and validated without anyone opening the app. Its conversation is an "intake" thread.

alter table mail_threads drop constraint mail_threads_kind_check;
alter table mail_threads add constraint mail_threads_kind_check check (kind in ('correction_request', 'conversation', 'intake'));

-- The user's part of their intake address; made the first time it is shown.
alter table users add column intake_token text unique;

create table mail_intakes (
  id uuid primary key,
  thread_id uuid not null references mail_threads (id) on delete cascade,
  message_id uuid not null references mail_messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  shipment_id uuid references shipments (id) on delete set null,
  -- extracting → validated | needs_destination | failed; skipped when the mail had no usable PDF.
  status text not null check (status in ('extracting', 'validating', 'validated', 'needs_destination', 'failed', 'skipped')),
  -- Shipment created for this email, or an existing one its subject named.
  created_shipment boolean not null default false,
  documents int not null default 0,
  findings int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mail_intakes_pending_idx on mail_intakes (created_at) where status in ('extracting', 'validating');
create index mail_intakes_thread_idx on mail_intakes (thread_id);
