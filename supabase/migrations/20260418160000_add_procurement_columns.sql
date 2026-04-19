-- Add new columns required by updated import/normalization flow

-- raw_imports: track import_status, original filename and stored mapping configuration
ALTER TABLE IF EXISTS raw_imports
  ADD COLUMN IF NOT EXISTS import_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS mapping_config jsonb;

-- raw_product_rows: store original payload as jsonb and additional raw_* fields
ALTER TABLE IF EXISTS raw_product_rows
  ADD COLUMN IF NOT EXISTS source_payload jsonb,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS raw_category text,
  ADD COLUMN IF NOT EXISTS raw_consumption_type text,
  ADD COLUMN IF NOT EXISTS raw_hazardous boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_storage_location text,
  ADD COLUMN IF NOT EXISTS raw_typical_site text;

-- normalized_products: add source_name, catalog_status and is_c_material
ALTER TABLE IF EXISTS normalized_products
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS catalog_status text DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS is_c_material boolean DEFAULT true;

-- supplier_product_mapping: ensure contract_price exists as numeric and supplier_sku
ALTER TABLE IF EXISTS supplier_product_mapping
  ADD COLUMN IF NOT EXISTS supplier_sku text,
  ADD COLUMN IF NOT EXISTS contract_price numeric DEFAULT 0;

-- Ensure minimal indexes for search
CREATE INDEX IF NOT EXISTS idx_normalized_products_product_name ON normalized_products USING gin (to_tsvector('simple', coalesce(product_name, '')));
CREATE INDEX IF NOT EXISTS idx_normalized_products_source_name ON normalized_products USING gin (to_tsvector('simple', coalesce(source_name, '')));
CREATE INDEX IF NOT EXISTS idx_raw_product_rows_supplier_name ON raw_product_rows (supplier_name);

-- Note: adjust types/constraints according to your exact schema and migrate existing data as needed.
