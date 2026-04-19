-- =====================================================================
-- Orders schema audit & hardening
-- Idempotent: safe to run multiple times. Preserves existing data.
-- Paste this into the Supabase SQL editor (project: qzmadzboeabcvficrgwa)
-- and click Run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. order_status enum (no-op if already there)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type public.order_status as enum ('requested', 'ordered', 'delivered');
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 2. orders — header columns & total
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists project_id   uuid,
  add column if not exists user_id      uuid,
  add column if not exists site_name    text,
  add column if not exists ordered_by   text,
  add column if not exists notes        text,
  add column if not exists total_price  numeric(12,2) not null default 0,
  add column if not exists created_at   timestamptz not null default now(),
  add column if not exists updated_at   timestamptz not null default now();

-- status column: only add if missing. Existing column may already be text.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='status'
  ) then
    alter table public.orders add column status public.order_status not null default 'requested';
  end if;
end$$;

-- FK orders.project_id → projects.id
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_project_id_fkey' and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 3. order_items — snapshots, line totals, FKs
-- ---------------------------------------------------------------------
alter table public.order_items
  add column if not exists product_name text,
  add column if not exists unit         text,
  add column if not exists quantity     numeric(12,3) not null default 0,
  add column if not exists unit_price   numeric(12,2),
  add column if not exists created_at   timestamptz not null default now();

-- line_total as a stored generated column (only add if missing)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='order_items' and column_name='line_total'
  ) then
    alter table public.order_items
      add column line_total numeric(12,2)
      generated always as (coalesce(unit_price,0) * coalesce(quantity,0)) stored;
  end if;
end$$;

-- FK order_items.order_id → orders.id
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_order_id_fkey' and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete cascade;
  end if;
end$$;

-- FK order_items.product_id → normalized_products.id
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_product_id_fkey' and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_product_id_fkey
      foreign key (product_id) references public.normalized_products(id) on delete set null;
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 4. supplier_product_mapping → normalized_products FK
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'spm_product_id_fkey' and conrelid = 'public.supplier_product_mapping'::regclass
  ) then
    alter table public.supplier_product_mapping
      add constraint spm_product_id_fkey
      foreign key (product_id) references public.normalized_products(id) on delete cascade;
  end if;
end$$;

-- ---------------------------------------------------------------------
-- 5. Indexes for performance
-- ---------------------------------------------------------------------
create index if not exists idx_orders_project_id  on public.orders(project_id);
create index if not exists idx_orders_status      on public.orders(status);
create index if not exists idx_orders_created_at  on public.orders(created_at desc);
create index if not exists idx_orders_user_id     on public.orders(user_id);

create index if not exists idx_order_items_order_id   on public.order_items(order_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);
create index if not exists idx_order_items_created_at on public.order_items(created_at desc);

create index if not exists idx_spm_product_id  on public.supplier_product_mapping(product_id);
create index if not exists idx_spm_supplier_id on public.supplier_product_mapping(supplier_id);

-- ---------------------------------------------------------------------
-- 6. Triggers — auto-maintain orders.total_price + orders.updated_at
-- ---------------------------------------------------------------------
create or replace function public.recalc_order_total(p_order_id uuid)
returns void
language sql
as $$
  update public.orders o
     set total_price = coalesce((
           select sum(coalesce(line_total, coalesce(unit_price,0) * coalesce(quantity,0)))
             from public.order_items
            where order_id = p_order_id
         ), 0),
         updated_at = now()
   where o.id = p_order_id;
$$;

create or replace function public.tg_order_items_recalc()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recalc_order_total(old.order_id);
    return old;
  else
    perform public.recalc_order_total(new.order_id);
    if (tg_op = 'UPDATE' and new.order_id <> old.order_id) then
      perform public.recalc_order_total(old.order_id);
    end if;
    return new;
  end if;
end$$;

drop trigger if exists trg_order_items_recalc on public.order_items;
create trigger trg_order_items_recalc
after insert or update or delete on public.order_items
for each row execute function public.tg_order_items_recalc();

-- One-time backfill for existing orders.
update public.orders o
   set total_price = coalesce((
         select sum(coalesce(oi.unit_price,0) * coalesce(oi.quantity,0))
           from public.order_items oi
          where oi.order_id = o.id
       ), 0);

-- ---------------------------------------------------------------------
-- 7. Backfill product_name / unit snapshots from current normalized_products
--    (only where missing — preserves any historical snapshot already stored).
-- ---------------------------------------------------------------------
update public.order_items oi
   set product_name = np.product_name,
       unit         = np.unit
  from public.normalized_products np
 where oi.product_id = np.id
   and (oi.product_name is null or oi.unit is null);

commit;
