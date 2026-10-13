-- Accounts and sessions. Passwords are scrypt hashes; a session row stores the SHA-256 of the
-- cookie token, never the token itself. Every shipment now belongs to the user who created it;
-- rows from before this migration have no owner and are not shown to anyone.

create table users (
  id uuid primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

alter table shipments add column user_id uuid references users (id) on delete cascade;
create index shipments_user_idx on shipments (user_id, created_at desc);
