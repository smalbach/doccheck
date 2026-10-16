-- Party screening (docs/SCREENING.md). A match an organization set aside as a false positive: this
-- party name (normalized, as partyKey() writes it) is not this list entry. Rows are never deleted while
-- the organization exists: removing one sets removed_at, so the table keeps who set aside what, why and
-- when, and who put it back (the audit log records both as screening.allowlist.add / .remove too).
-- The lists themselves are global: they live on disk (data/screening), not in the database.
create table screening_allowlist (
  id uuid primary key,
  org_id uuid not null references organizations (id) on delete cascade,
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
create unique index screening_allowlist_active_idx on screening_allowlist (org_id, party_key, list_id, entry_id) where removed_at is null;
create index screening_allowlist_org_idx on screening_allowlist (org_id, created_at desc);
