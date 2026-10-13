-- Agent decisions per validation run, and a log of every model call (local tracing).

alter table validations add column agent jsonb;

create table llm_calls (
  id bigserial primary key,
  provider text not null,
  prompt_version text not null,
  cache_key text not null,
  cached boolean not null,
  ms int not null,
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now()
);
create index llm_calls_created_idx on llm_calls (created_at desc);
