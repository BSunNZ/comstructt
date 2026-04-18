alter table if exists supplier_product_mapping
  add column if not exists project_prices jsonb not null default '{}'::jsonb;
