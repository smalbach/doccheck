-- Party screening (docs/SCREENING.md). A match an account set aside as a false positive: this party
-- name (normalized, as partyKey() writes it) is not this list entry. Rows are never deleted while the
-- account exists: removing one sets removed_at, so the table is also the audit trail of who set aside
-- what, why and when, and who put it back.
create table screening_allowlist (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  party_name text not null,
  party_key text not null,
  list_id text not null,
  entry_id text not null,
  entry_name text not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_by uuid references users (id) on delete set null,
  removed_at timestamptz,
  removed_reason text
);
create unique index screening_allowlist_active_idx on screening_allowlist (user_id, party_key, list_id, entry_id) where removed_at is null;
create index screening_allowlist_user_idx on screening_allowlist (user_id, created_at desc);
