create table if not exists projects (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table if exists projects
  add column if not exists city text,
  add column if not exists zip_code text,
  add column if not exists address text;
