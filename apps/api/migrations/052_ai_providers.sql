-- Embedding models other than bge-m3 (OpenAI, Gemini, another Ollama model) give vectors of other
-- sizes: the tariff vector column takes any size. Rows are always compared within one embedder.
do $$
begin
  if to_regclass('public.tariff_vectors') is not null then
    alter table tariff_vectors alter column embedding type vector;
  end if;
end
$$;
