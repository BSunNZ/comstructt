alter table public.orders
add column if not exists rejection_reason text;
