-- Roles and runtime settings. An admin is set by ADMIN_EMAILS (never by signing up) and can change
-- the model and OCR settings from the web; those changes are stored here and override .env until reset.

alter table users add column role text not null default 'user' check (role in ('user', 'admin'));

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);
