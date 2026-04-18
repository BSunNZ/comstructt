create table if not exists procurement_order_settings (
  id text primary key,
  auto_approve_below numeric not null default 200,
  central_procurement_categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists procurement_orders (
  id uuid primary key,
  project_name text not null,
  foreman_name text not null,
  status text not null default 'draft',
  approval_route text not null default 'project_manager',
  approval_reason text,
  total_amount numeric not null default 0,
  currency text not null default 'CHF',
  submitted_at timestamptz,
  approved_at timestamptz,
  ordered_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists procurement_order_items (
  id uuid primary key,
  order_id uuid not null references procurement_orders (id) on delete cascade,
  product_id uuid references normalized_products (id) on delete set null,
  display_name text not null,
  normalized_category text not null,
  unit text,
  unit_price numeric not null,
  quantity numeric not null,
  line_total numeric not null,
  supplier_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_procurement_orders_status
  on procurement_orders (status);

create index if not exists idx_procurement_orders_created_at
  on procurement_orders (created_at desc);

create index if not exists idx_procurement_order_items_order_id
  on procurement_order_items (order_id);

insert into procurement_order_settings (
  id,
  auto_approve_below,
  central_procurement_categories
)
values (
  'default',
  200,
  array['Electrical', 'Consumables']
)
on conflict (id) do nothing;
