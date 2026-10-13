-- What the user decided about each finding (docs/FINDINGS.md). A finding is found again across
-- validation runs by its fingerprint: the rule and the evidence's fields and values, not the document
-- ids, so uploading a document again with the same values keeps the decision, and correcting a value
-- makes a new finding (the old one shows as resolved).

create function dc_finding_fingerprint(p_rule text, p_evidence jsonb) returns text language sql immutable as $$
  select md5(p_rule || '|' || coalesce((
    select string_agg(x, ';' order by x) from (
      select coalesce(e->>'field', '') || '=' || coalesce(e->>'value', '') as x
      from jsonb_array_elements(case when jsonb_typeof(p_evidence) = 'array' then p_evidence else '[]'::jsonb end) e
    ) parts
  ), ''))
$$;

alter table findings add column fingerprint text;
update findings set fingerprint = dc_finding_fingerprint(rule_id, evidence);
alter table findings alter column fingerprint set not null;
create index findings_fingerprint_idx on findings (shipment_id, fingerprint);

create function dc_on_finding() returns trigger language plpgsql as $$
begin
  new.fingerprint := dc_finding_fingerprint(new.rule_id, new.evidence);
  return new;
end $$;
create trigger findings_fingerprint before insert or update of rule_id, evidence on findings
  for each row execute function dc_on_finding();

-- Every decision, oldest first; the latest one per fingerprint is the finding's status. "open" undoes
-- an earlier decision. A finding that disappears from the next run is resolved: that is not stored.
create table finding_reviews (
  id uuid primary key,
  shipment_id uuid not null references shipments (id) on delete cascade,
  fingerprint text not null,
  rule_id text not null,
  status text not null check (status in ('open', 'waiting_supplier', 'accepted', 'false_positive')),
  note text,
  user_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index finding_reviews_idx on finding_reviews (shipment_id, fingerprint, created_at desc);

create view finding_status as
  select distinct on (shipment_id, fingerprint) shipment_id, fingerprint, status, note, user_id, created_at
  from finding_reviews order by shipment_id, fingerprint, created_at desc, id;

/** Accepted as a risk or marked a false positive: the finding no longer needs anything. */
create function dc_finding_closed(p_shipment uuid, p_fingerprint text) returns boolean language sql stable as $$
  select exists (select 1 from finding_status s where s.shipment_id = p_shipment and s.fingerprint = p_fingerprint and s.status in ('accepted', 'false_positive'))
$$;
