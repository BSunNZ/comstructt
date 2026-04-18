alter table if exists suppliers
  add column if not exists supplier_discount_pct numeric;

create index if not exists idx_suppliers_supplier_discount_pct
  on suppliers (supplier_discount_pct);
