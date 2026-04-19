-- Critical procurement schema hardening
-- Adds company tenancy, approval/audit traceability, and procurement-specific entities.

create extension if not exists pgcrypto;

-- Resolve current authenticated user id safely inside SQL triggers/functions.
create or replace function public.current_auth_user_id()
returns uuid
language plpgsql
stable
as $$
declare
	claim_sub text;
begin
	claim_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
	if claim_sub is null then
		return null;
	end if;
	return claim_sub::uuid;
exception when others then
	return null;
end;
$$;

create table if not exists public.companies (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	created_at timestamptz not null default now()
);

-- Add missing FK from users.company_id -> companies.id.
do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'users_company_id_fkey'
		  and conrelid = 'public.users'::regclass
	) then
		alter table public.users
			add constraint users_company_id_fkey
			foreign key (company_id) references public.companies(id) on delete restrict;
	end if;
end
$$;

-- Delivery and contacts support from real offer templates.
do $$
begin
	if not exists (select 1 from pg_type where typname = 'delivery_method') then
		create type delivery_method as enum ('pickup', 'delivery');
	end if;
end
$$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'delivery_status') then
		create type delivery_status as enum ('pending', 'in_transit', 'delivered', 'cancelled');
	end if;
end
$$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'order_contact_type') then
		create type order_contact_type as enum ('orderer', 'site_contact', 'invoice', 'delivery');
	end if;
end
$$;

create table if not exists public.order_delivery (
	id uuid primary key default gen_random_uuid(),
	order_id uuid not null unique references public.orders(id) on delete cascade,
	delivery_method delivery_method not null,
	desired_date date,
	desired_time_from time,
	desired_time_to time,
	actual_delivery_date timestamptz,
	status delivery_status not null default 'pending',
	weight_kg numeric,
	notes text,
	created_at timestamptz not null default now()
);

create table if not exists public.order_contacts (
	id uuid primary key default gen_random_uuid(),
	order_id uuid not null references public.orders(id) on delete cascade,
	contact_type order_contact_type not null,
	name text,
	phone text,
	mobile text,
	email text,
	created_at timestamptz not null default now()
);

create table if not exists public.payment_terms (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	net_days integer,
	discount_percent numeric,
	discount_days integer,
	created_at timestamptz not null default now(),
	check (net_days is null or net_days > 0),
	check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
	check (discount_days is null or discount_days > 0)
);

alter table public.orders
	add column if not exists payment_term_id uuid,
	add column if not exists expected_delivery_days integer;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'orders_payment_term_id_fkey'
		  and conrelid = 'public.orders'::regclass
	) then
		alter table public.orders
			add constraint orders_payment_term_id_fkey
			foreign key (payment_term_id) references public.payment_terms(id) on delete set null;
	end if;
end
$$;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'orders_expected_delivery_days_check'
		  and conrelid = 'public.orders'::regclass
	) then
		alter table public.orders
			add constraint orders_expected_delivery_days_check
			check (expected_delivery_days is null or expected_delivery_days > 0);
	end if;
end
$$;

-- Status history for compliance and debugging.
create table if not exists public.order_status_history (
	id uuid primary key default gen_random_uuid(),
	order_id uuid not null references public.orders(id) on delete cascade,
	old_status order_status,
	new_status order_status not null,
	reason text,
	changed_by uuid references public.users(id) on delete set null,
	changed_at timestamptz not null default now()
);

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
as $$
begin
	if tg_op = 'INSERT' then
		insert into public.order_status_history (order_id, old_status, new_status, changed_by)
		values (new.id, null, new.status, public.current_auth_user_id());
		return new;
	end if;

	if tg_op = 'UPDATE' and old.status is distinct from new.status then
		insert into public.order_status_history (order_id, old_status, new_status, changed_by)
		values (new.id, old.status, new.status, public.current_auth_user_id());
	end if;

	return new;
end;
$$;

drop trigger if exists trg_orders_status_history on public.orders;
create trigger trg_orders_status_history
after insert or update of status on public.orders
for each row execute function public.log_order_status_change();

-- Generic audit table for key business entities.
create table if not exists public.audit_logs (
	id uuid primary key default gen_random_uuid(),
	table_name text not null,
	record_id uuid not null,
	action text not null,
	old_data jsonb,
	new_data jsonb,
	changed_by uuid references public.users(id) on delete set null,
	changed_at timestamptz not null default now(),
	check (action in ('insert', 'update', 'delete'))
);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
as $$
declare
	action_name text;
	actor_id uuid;
	record_uuid uuid;
begin
	action_name := lower(tg_op);
	actor_id := public.current_auth_user_id();
	if tg_op = 'DELETE' then
		record_uuid := old.id;
	else
		record_uuid := new.id;
	end if;

	insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
	values (
		tg_table_name,
		record_uuid,
		action_name,
		case when tg_op = 'INSERT' then null else to_jsonb(old) end,
		case when tg_op = 'DELETE' then null else to_jsonb(new) end,
		actor_id
	);

	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_orders_audit on public.orders;
create trigger trg_orders_audit
after insert or update or delete on public.orders
for each row execute function public.audit_row_change();

drop trigger if exists trg_order_items_audit on public.order_items;
create trigger trg_order_items_audit
after insert or update or delete on public.order_items
for each row execute function public.audit_row_change();

drop trigger if exists trg_normalized_products_audit on public.normalized_products;
create trigger trg_normalized_products_audit
after insert or update or delete on public.normalized_products
for each row execute function public.audit_row_change();

-- Product and pricing gaps from uploaded templates/CSV.
create table if not exists public.discount_groups (
	id uuid primary key default gen_random_uuid(),
	name text not null unique,
	description text,
	discount_percent numeric,
	created_at timestamptz not null default now(),
	check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100))
);

create table if not exists public.product_discount_groups (
	id uuid primary key default gen_random_uuid(),
	product_id uuid not null references public.normalized_products(id) on delete cascade,
	discount_group_id uuid not null references public.discount_groups(id) on delete cascade,
	created_at timestamptz not null default now(),
	unique (product_id, discount_group_id)
);

create table if not exists public.product_variants (
	id uuid primary key default gen_random_uuid(),
	base_product_id uuid not null references public.normalized_products(id) on delete cascade,
	variant_name text,
	variant_sku text,
	variant_price numeric,
	is_default boolean not null default false,
	created_at timestamptz not null default now(),
	check (variant_price is null or variant_price >= 0)
);

alter table public.normalized_products
	add column if not exists consumption_type text,
	add column if not exists is_hazmat boolean not null default false,
	add column if not exists typical_site text,
	add column if not exists storage_location text,
	add column if not exists weight_kg numeric;

create table if not exists public.order_line_details (
	id uuid primary key default gen_random_uuid(),
	order_item_id uuid not null references public.order_items(id) on delete cascade,
	discount_group text,
	discount_percent numeric,
	surcharge_amount numeric,
	supplier_npk_code text,
	spec_notes text,
	created_at timestamptz not null default now(),
	check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100))
);

create table if not exists public.order_template_items (
	id uuid primary key default gen_random_uuid(),
	template_id uuid not null references public.order_templates(id) on delete cascade,
	product_id uuid not null references public.normalized_products(id) on delete cascade,
	quantity integer not null,
	created_at timestamptz not null default now(),
	check (quantity > 0),
	unique (template_id, product_id)
);

-- Performance indexes for common operations.
create index if not exists idx_companies_name on public.companies(name);
create index if not exists idx_order_delivery_order_id on public.order_delivery(order_id);
create index if not exists idx_order_contacts_order_id on public.order_contacts(order_id);
create index if not exists idx_orders_payment_term_id on public.orders(payment_term_id);
create index if not exists idx_order_status_history_order_id on public.order_status_history(order_id);
create index if not exists idx_order_status_history_changed_at on public.order_status_history(changed_at desc);
create index if not exists idx_audit_logs_table_record on public.audit_logs(table_name, record_id);
create index if not exists idx_audit_logs_changed_at on public.audit_logs(changed_at desc);
create index if not exists idx_product_discount_groups_product_id on public.product_discount_groups(product_id);
create index if not exists idx_product_variants_base_product_id on public.product_variants(base_product_id);
create index if not exists idx_order_template_items_template_id on public.order_template_items(template_id);

create index if not exists idx_normalized_products_is_hazmat on public.normalized_products(is_hazmat);
create index if not exists idx_orders_status_created_at on public.orders(status, created_at desc);
