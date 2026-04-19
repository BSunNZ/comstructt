-- 2026-04-19 — Project-specific pricing audit columns on order_items.
--
-- Context:
--   supplier_product_mapping.project_prices is a JSONB column keyed by
--   project_id with negotiated unit prices. When a user orders from inside
--   a project context, the cart now uses that override instead of
--   contract_price. We need to persist on each order line:
--     • unit_price_used  — already stored as `unit_price` (no change).
--     • price_source     — "project" or "contract".
--     • project_id       — the project the price was resolved against.
--
-- This migration is additive and idempotent — safe to run multiple times.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS price_source text
    CHECK (price_source IN ('project', 'contract'));

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS project_id uuid
    REFERENCES public.projects(id) ON DELETE SET NULL;

-- Helpful indexes for procurement reporting (most-recent project lines,
-- price-source breakdowns).
CREATE INDEX IF NOT EXISTS order_items_project_id_idx
  ON public.order_items (project_id);

CREATE INDEX IF NOT EXISTS order_items_price_source_idx
  ON public.order_items (price_source);

-- Belt-and-braces: ensure project_prices exists on supplier_product_mapping
-- so the new resolver doesn't blow up against an older schema. If the column
-- already exists this is a no-op.
ALTER TABLE public.supplier_product_mapping
  ADD COLUMN IF NOT EXISTS project_prices jsonb DEFAULT '{}'::jsonb;
