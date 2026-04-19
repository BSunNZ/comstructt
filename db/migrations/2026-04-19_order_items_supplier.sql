-- Adds a snapshot of the resolved supplier name onto each order_items row.
-- Written at checkout time by the app (createOrder) so historical orders
-- always show the actual supplier the price was sourced from, even after
-- supplier_product_mapping rows are edited or deleted.
--
-- Nullable: the column is best-effort. When no supplier could be resolved
-- (no mapping for the product), the app writes NULL and the UI shows
-- "Lieferant nicht verfügbar".

alter table public.order_items
  add column if not exists supplier_name text;

comment on column public.order_items.supplier_name is
  'Snapshot of suppliers.name at checkout time. Null when no supplier mapping existed for the product.';

-- Helpful for "orders by supplier" reports later. Cheap on the current
-- order volume, dropped/recreated as a no-op if it already exists.
create index if not exists order_items_supplier_name_idx
  on public.order_items (supplier_name);
