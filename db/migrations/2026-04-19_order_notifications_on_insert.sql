-- ============================================================================
-- Extend order notifications to ALSO fire when a new order is inserted
-- directly with a user-facing status (delivered / rejected / ordered).
-- Apply manually in Supabase SQL editor.
-- ============================================================================

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
  _status   text;
begin
  -- On UPDATE: only fire when status actually changed.
  if (TG_OP = 'UPDATE') then
    if (new.status is not distinct from old.status) then
      return new;
    end if;
  end if;
  -- On INSERT: always evaluate the new status below.

  _status := new.status;
  _short_id := upper(right(replace(new.id::text, '-', ''), 4));

  if (_status = 'ordered') then
    _type  := 'approved';
    _title := 'Bestellung genehmigt';
    _body  := format('Deine Bestellung #%s wurde freigegeben.', _short_id);
  elsif (_status = 'rejected') then
    if (new.rejection_reason is not null and length(trim(new.rejection_reason)) > 0) then
      _type  := 'requires_changes';
      _title := 'Bestellung prüfen';
      _body  := format('Änderungen für Bestellung #%s erforderlich.', _short_id);
    else
      _type  := 'rejected';
      _title := 'Bestellung abgelehnt';
      _body  := format('Deine Bestellung #%s wurde abgelehnt.', _short_id);
    end if;
  elsif (_status = 'delivered') then
    _type  := 'approved';
    _title := 'Bestellung geliefert';
    _body  := format('Bestellung #%s wurde geliefert.', _short_id);
  else
    return new;
  end if;

  insert into public.notifications (user_id, project_id, order_id, type, title, body)
  values (new.user_id, new.project_id, new.id, _type, _title, _body);

  return new;
end;
$$;

-- Replace the UPDATE-only trigger with one that fires on INSERT OR UPDATE.
drop trigger if exists tg_orders_notify_status_change on public.orders;
create trigger tg_orders_notify_status_change
  after insert or update of status on public.orders
  for each row execute function public.fn_orders_notify_status_change();
