-- The language the user reads the app in, so mail DocCheck writes on its own (the summary of
-- documents sent by email) is in that language too. The web app sets it when the language changes.
alter table users add column language text check (language in ('en', 'es', 'fr'));
