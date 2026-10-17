-- Embeddings of the tariff lines (8 and 10 digits) of each schedule (bge-m3, 1024 dimensions), for
-- the description-to-heading search. Needs the pgvector extension: where it is not installed (a plain
-- local Postgres) nothing is created and the API keeps the vectors in memory from data/tariff/index.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    create extension if not exists vector;
    execute $sql$
      create table if not exists tariff_vectors (
        schedule text not null check (schedule in ('CA', 'US')),
        embedder text not null,
        edition text not null,
        code text not null,
        embedding vector(1024) not null,
        primary key (schedule, embedder, code)
      )
    $sql$;
  end if;
end
$$;
