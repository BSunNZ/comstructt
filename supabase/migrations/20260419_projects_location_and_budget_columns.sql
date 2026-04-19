-- Ensure projects has location and budget columns used by managed projects and spend analytics.
alter table if exists projects
  add column if not exists city text,
  add column if not exists zip_code text,
  add column if not exists address text,
  add column if not exists budget_daily numeric not null default 100;

-- Backfill budget defaults for existing rows.
update projects
set budget_daily = 100
where budget_daily is null;
