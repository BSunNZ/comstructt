-- Add budget_daily to projects with sensible default and backfill existing rows
alter table if exists projects
  add column if not exists budget_daily numeric not null default 100;

-- Backfill any existing NULL or missing values to 100 (idempotent)
update projects set budget_daily = 100 where budget_daily is null;

-- Note: budget_total is computed dynamically in the analytics layer.
