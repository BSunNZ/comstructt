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

create index if not exists idx_raw_product_rows_import_id on raw_product_rows (import_id);
create index if not exists idx_normalized_products_catalog_status on normalized_products (catalog_status);
create index if not exists idx_supplier_product_mapping_product_id on supplier_product_mapping (product_id);
