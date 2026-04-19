-- Adds the optional `rejection_reason` column used by the Order Overview
-- detail dialog. When an order is moved to status='rejected' by the external
-- procurement authority, they may write a short explanation into this column.
-- The site-crew app only reads it; it never writes here.
alter table public.orders
  add column if not exists rejection_reason text;

comment on column public.orders.rejection_reason is
  'Free-text reason set by the procurement authority when status is set to ''rejected''. Read-only from the site-crew app.';
