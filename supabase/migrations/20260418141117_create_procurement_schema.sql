create extension if not exists pgcrypto;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'user_role') then
		create type user_role as enum ('foreman', 'procurement', 'project_manager', 'admin');
	end if;
end
$$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'project_status') then
		create type project_status as enum ('active', 'completed');
	end if;
end
$$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'import_type') then
		create type import_type as enum ('csv', 'excel', 'pdf', 'api');
	end if;
end
$$;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'order_status') then
		create type order_status as enum ('draft', 'pending_approval', 'approved', 'ordered', 'delivered', 'rejected');
	end if;
end
$$;

create table if not exists public.users (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	email text not null unique,
	role user_role not null,
	company_id uuid,
	created_at timestamptz not null default now()
);

create table if not exists public.projects (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	budget numeric,
	status project_status not null default 'active',
	project_manager_id uuid references public.users(id) on delete set null,
	created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	import_type import_type not null,
	contract_active boolean not null default false,
	created_at timestamptz not null default now()
);

create table if not exists public.raw_imports (
	id uuid primary key default gen_random_uuid(),
	supplier_id uuid not null references public.suppliers(id) on delete cascade,
	file_url text not null,
	uploaded_by uuid not null references public.users(id) on delete restrict,
	created_at timestamptz not null default now()
);

create table if not exists public.raw_product_rows (
	id uuid primary key default gen_random_uuid(),
	import_id uuid not null references public.raw_imports(id) on delete cascade,
	raw_name text,
	raw_description text,
	raw_price numeric,
	raw_unit text,
	raw_sku text,
	ai_processed boolean not null default false,
	created_at timestamptz not null default now()
);

create table if not exists public.normalized_products (
	id uuid primary key default gen_random_uuid(),
	category text,
	subcategory text,
	product_name text not null,
	size text,
	unit text,
	packaging text,
	confidence_score numeric,
	approved boolean not null default false,
	created_at timestamptz not null default now()
);

create table if not exists public.supplier_product_mapping (
	id uuid primary key default gen_random_uuid(),
	supplier_id uuid not null references public.suppliers(id) on delete cascade,
	product_id uuid not null references public.normalized_products(id) on delete cascade,
	supplier_sku text,
	contract_price numeric,
	min_order_qty integer,
	created_at timestamptz not null default now(),
	unique (supplier_id, product_id, supplier_sku)
);

create table if not exists public.orders (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.users(id) on delete restrict,
	project_id uuid not null references public.projects(id) on delete restrict,
	total_price numeric,
	status order_status not null default 'draft',
	created_at timestamptz not null default now()
);

create table if not exists public.order_items (
	id uuid primary key default gen_random_uuid(),
	order_id uuid not null references public.orders(id) on delete cascade,
	product_id uuid not null references public.normalized_products(id) on delete restrict,
	quantity integer not null,
	unit_price numeric,
	created_at timestamptz not null default now(),
	check (quantity > 0)
);

create table if not exists public.approval_rules (
	id uuid primary key default gen_random_uuid(),
	max_auto_approve numeric,
	restricted_category text,
	approver_role user_role,
	created_at timestamptz not null default now()
);

create table if not exists public.favorites (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.users(id) on delete cascade,
	product_id uuid not null references public.normalized_products(id) on delete cascade,
	created_at timestamptz not null default now(),
	unique (user_id, product_id)
);

create table if not exists public.order_templates (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	project_id uuid not null references public.projects(id) on delete cascade,
	created_by uuid not null references public.users(id) on delete restrict,
	created_at timestamptz not null default now()
);

create index if not exists idx_users_company_id on public.users(company_id);
create index if not exists idx_projects_project_manager_id on public.projects(project_manager_id);
create index if not exists idx_raw_imports_supplier_id on public.raw_imports(supplier_id);
create index if not exists idx_raw_imports_uploaded_by on public.raw_imports(uploaded_by);
create index if not exists idx_raw_product_rows_import_id on public.raw_product_rows(import_id);
create index if not exists idx_supplier_product_mapping_supplier_id on public.supplier_product_mapping(supplier_id);
create index if not exists idx_supplier_product_mapping_product_id on public.supplier_product_mapping(product_id);
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_project_id on public.orders(project_id);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);
create index if not exists idx_favorites_user_id on public.favorites(user_id);
create index if not exists idx_favorites_product_id on public.favorites(product_id);
create index if not exists idx_order_templates_project_id on public.order_templates(project_id);
create index if not exists idx_order_templates_created_by on public.order_templates(created_by);
