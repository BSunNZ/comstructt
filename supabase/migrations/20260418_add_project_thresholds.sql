alter table if exists projects
  add column if not exists min_approval numeric;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'orders'
  ) then
    alter table orders
      add column if not exists project_id uuid references projects (id) on delete set null;

    update orders
    set project_id = projects.id
    from projects
    where orders.project_id is null
      and orders.site_name = projects.name;

    execute 'create index if not exists idx_orders_project_id on orders (project_id)';
  end if;
end $$;
