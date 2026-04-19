create table if not exists projects (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists project_specific_prices (
  id uuid primary key,
  project_id uuid not null references projects (id) on delete cascade,
  supplier_product_mapping_id uuid not null references supplier_product_mapping (id) on delete cascade,
  project_price numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_project_specific_prices_unique
  on project_specific_prices (project_id, supplier_product_mapping_id);

create index if not exists idx_project_specific_prices_project_id
  on project_specific_prices (project_id);

create index if not exists idx_project_specific_prices_mapping_id
  on project_specific_prices (supplier_product_mapping_id);
