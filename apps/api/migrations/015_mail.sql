-- Email inside the app (docs/MESSAGING.md): conversations with suppliers, the outbox the API sends
-- from with retries, what arrives (IMAP or the inbound webhook) and its attachments.

-- A conversation: a request for corrected documents about a shipment, or any thread with a company.
-- `token` goes into the subject ("[DC-k3x9p2]") and the reply-to address (docs+k3x9p2@...), so
-- replies find their thread even when a mail client drops the In-Reply-To header.
create table mail_threads (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  shipment_id uuid references shipments (id) on delete set null,
  party_id uuid references parties (id) on delete set null,
  token text not null unique,
  kind text not null check (kind in ('correction_request', 'conversation')),
  subject text not null,
  -- awaiting: we wrote last and wait; replied: they answered (to read or act on); closed: done.
  status text not null default 'awaiting' check (status in ('awaiting', 'replied', 'closed')),
  language text,
  -- Findings of the latest validation the request is about.
  fingerprints text[] not null default '{}',
  -- When to follow up if nobody answered.
  due_at timestamptz,
  unread int not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index mail_threads_user_idx on mail_threads (user_id, last_message_at desc);
create index mail_threads_shipment_idx on mail_threads (shipment_id);
create index mail_threads_party_idx on mail_threads (party_id);

create table mail_messages (
  id uuid primary key,
  -- Null for a received message no thread claimed (admins assign it).
  thread_id uuid references mail_threads (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  direction text not null check (direction in ('out', 'in')),
  -- out: queued → sending → sent | failed (retried until attempts run out); in: received.
  status text not null check (status in ('queued', 'sending', 'sent', 'failed', 'received')),
  from_addr text not null,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text not null,
  text_body text not null default '',
  -- RFC 5322 Message-ID without the angle brackets.
  message_id text,
  in_reply_to text,
  "references" text[] not null default '{}',
  attempts int not null default 0,
  next_attempt_at timestamptz,
  error text,
  -- smtp, or log when no SMTP server is configured (the message is only captured).
  transport text,
  sent_at timestamptz,
  received_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index mail_messages_thread_idx on mail_messages (thread_id, created_at);
create index mail_messages_outbox_idx on mail_messages (next_attempt_at) where status = 'queued';
create unique index mail_messages_message_id_idx on mail_messages (message_id) where message_id is not null;
create index mail_messages_unassigned_idx on mail_messages (created_at desc) where thread_id is null;

create table mail_attachments (
  id uuid primary key,
  message_id uuid not null references mail_messages (id) on delete cascade,
  filename text not null,
  content_type text not null,
  size int not null,
  storage_key text not null,
  -- The shipment document made from it, once imported.
  document_id uuid references documents (id) on delete set null,
  created_at timestamptz not null default now()
);
create index mail_attachments_message_idx on mail_attachments (message_id);

-- Addresses the user wrote to, per company: suggested next time.
create table mail_contacts (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  party_id uuid references parties (id) on delete set null,
  email text not null,
  name text,
  last_used_at timestamptz not null default now(),
  unique (user_id, email)
);
create index mail_contacts_party_idx on mail_contacts (party_id);

-- Where the IMAP poller stopped, per mailbox.
create table mail_cursors (
  mailbox text primary key,
  uid_validity bigint not null,
  last_uid bigint not null,
  polled_at timestamptz not null default now(),
  error text
);
