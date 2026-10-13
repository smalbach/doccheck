-- The exact model build behind each call: an Ollama tag such as "latest" can be replaced by a pull.
alter table llm_calls add column model_version text;
