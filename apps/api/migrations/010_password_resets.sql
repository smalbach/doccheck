-- "Forgot password?" links. A row stores the SHA-256 of the emailed token, never the token itself;
-- a link works once (used_at) and for 30 minutes (expires_at). Using one deletes the user's others.

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index password_resets_user_idx on password_resets (user_id);
