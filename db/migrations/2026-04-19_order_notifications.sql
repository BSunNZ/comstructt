-- ============================================================================
-- Realtime in-app notifications for order status changes
-- ----------------------------------------------------------------------------
-- Apply manually in your Supabase project SQL editor (or via `supabase db push`).
-- Adds:
--   1. public.notifications table       — one row per user-facing event
--   2. tg_orders_notify_status_change   — fires on UPDATE of orders.status
--   3. Realtime publication entry       — so the client can subscribe
-- ============================================================================

-- 1. Table -------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  -- Nullable: this app currently has no auth wiring; orders carry a
  -- nullable user_id too. We mirror that and filter client-side by
  -- project_id when no user is signed in.
  user_id     uuid,
  project_id  uuid,
  order_id    uuid references public.orders(id) on delete cascade,
  -- 'approved' | 'rejected' | 'requires_changes'
  -- Kept as text instead of an enum so adding new types later doesn't
  -- require a migration.
  type        text not null,
  title       text not null,
  body        text not null
);

create index if not exists notifications_project_id_idx on public.notifications(project_id);
create index if not exists notifications_user_id_idx on public.notifications(user_id);
create index if not exists notifications_created_at_desc_idx on public.notifications(created_at desc);

-- 2. RLS ---------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "notifications read all" on public.notifications;
-- Demo policy: any authenticated or anon role may read. Tighten once auth
-- is wired (e.g. `using (auth.uid() = user_id)`).
create policy "notifications read all"
  on public.notifications for select using (true);

-- 3. Trigger: write a notification whenever an order's status changes ------
create or replace function public.fn_orders_notify_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _short_id text;
  _type     text;
  _title    text;
  _body     text;
begin
  if (TG_OP <> 'UPDATE') then
    return new;
  end if;
  -- Only fire when status actually changes.
  if (new.status is not distinct from old.status) then
    return new;
  end if;

  -- Last 4 of the UUID — stable, short, demo-friendly "#1042" style.
  _short_id := upper(right(replace(new.id::text, '-', ''), 4));

  if (new.status = 'ordered') then
    _type  := 'approved';
    _title := 'Bestellung genehmigt';
    _body  := format('Deine Bestellung #%s wurde freigegeben.', _short_id);
  elsif (new.status = 'rejected') then
    -- A non-empty rejection_reason means the procurement office wants
    -- changes (vs. an outright reject). UX: amber "requires_changes".
    if (new.rejection_reason is not null and length(trim(new.rejection_reason)) > 0) then
      _type  := 'requires_changes';
      _title := 'Bestellung prüfen';
      _body  := format('Änderungen für Bestellung #%s erforderlich.', _short_id);
    else
      _type  := 'rejected';
      _title := 'Bestellung abgelehnt';
      _body  := format('Deine Bestellung #%s wurde abgelehnt.', _short_id);
    end if;
  elsif (new.status = 'delivered') then
    _type  := 'approved';
    _title := 'Bestellung geliefert';
    _body  := format('Bestellung #%s wurde geliefert.', _short_id);
  else
    -- Any other transition (e.g. → requested) is not user-facing.
    return new;
  end if;

  insert into public.notifications (user_id, project_id, order_id, type, title, body)
  values (new.user_id, new.project_id, new.id, _type, _title, _body);

  return new;
end;
$$;

drop trigger if exists tg_orders_notify_status_change on public.orders;
create trigger tg_orders_notify_status_change
  after update of status on public.orders
  for each row execute function public.fn_orders_notify_status_change();

-- 4. Realtime ----------------------------------------------------------------
-- Add to the supabase_realtime publication so clients can subscribe via
-- supabase.channel(...).on('postgres_changes', { event:'INSERT', table:'notifications' }).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
exception
  -- Publication does not exist on local/non-Supabase Postgres — safe to skip.
  when undefined_object then null;
end $$;
