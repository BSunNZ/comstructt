create table if not exists suppliers (
  id uuid primary key,
  name text not null unique,
  import_type text,
  contract_active boolean default true,
  created_at timestamptz not null default now()
);

create table if not exists raw_imports (
  id uuid primary key,
  supplier_id uuid references suppliers (id) on delete set null,
  file_url text not null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  import_status text not null default 'draft',
  original_filename text,
  mapping_config jsonb not null default '[]'::jsonb
);

create table if not exists raw_product_rows (
  id uuid primary key,
  import_id uuid not null references raw_imports (id) on delete cascade,
  raw_name text,
  raw_description text,
  raw_price numeric,
  raw_unit text,
  raw_sku text,
  ai_processed boolean default false,
  created_at timestamptz not null default now(),
  supplier_name text,
  raw_category text,
  raw_consumption_type text,
  raw_hazardous boolean default false,
  raw_storage_location text,
  raw_typical_site text,
  source_payload jsonb not null default '{}'::jsonb
);

create table if not exists normalized_products (
  id uuid primary key,
  category text not null,
  subcategory text,
  product_name text not null,
  size text,
  unit text,
  packaging text,
  confidence_score double precision,
  approved boolean default false,
  created_at timestamptz not null default now(),
  source_name text,
  source_category text,
  catalog_status text not null default 'imported',
  is_c_material boolean not null default true,
  consumption_type text,
  hazardous boolean default false,
  storage_location text,
  typical_site text
);

create table if not exists supplier_product_mapping (
  id uuid primary key,
  supplier_id uuid not null references suppliers (id) on delete cascade,
  product_id uuid not null references normalized_products (id) on delete cascade,
  supplier_sku text,
  contract_price numeric,
  min_order_qty integer,
  created_at timestamptz not null default now()
);

alter table if exists raw_imports
  alter column supplier_id drop not null;

alter table if exists raw_imports
  alter column uploaded_by drop not null;

alter table if exists raw_imports
  add column if not exists import_status text not null default 'draft',
  add column if not exists original_filename text,
  add column if not exists mapping_config jsonb not null default '[]'::jsonb;

alter table if exists raw_product_rows
  add column if not exists supplier_name text,
  add column if not exists raw_category text,
  add column if not exists raw_consumption_type text,
  add column if not exists raw_hazardous boolean default false,
  add column if not exists raw_storage_location text,
  add column if not exists raw_typical_site text,
  add column if not exists source_payload jsonb not null default '{}'::jsonb;

alter table if exists normalized_products
  add column if not exists source_name text,
  add column if not exists source_category text,
  add column if not exists catalog_status text not null default 'imported',
  add column if not exists is_c_material boolean not null default true,
  add column if not exists consumption_type text,
  add column if not exists hazardous boolean default false,
  add column if not exists storage_location text,
  add column if not exists typical_site text;

create index if not exists idx_raw_imports_supplier_id on raw_imports (supplier_id);
create index if not exists idx_raw_product_rows_import_id on raw_product_rows (import_id);
create index if not exists idx_normalized_products_catalog_status on normalized_products (catalog_status);
create index if not exists idx_supplier_product_mapping_product_id on supplier_product_mapping (product_id);
create index if not exists idx_supplier_product_mapping_supplier_id on supplier_product_mapping (supplier_id);
