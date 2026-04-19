import { supabase } from "@/lib/supabase";
import { CartLine } from "@/data/catalog";

// Postgres enum order_status — the canonical lifecycle.
// CREATE TYPE order_status AS ENUM ('requested', 'ordered', 'delivered', 'rejected');
// The app NEVER writes any other value (no 'draft', no 'approved', no 'pending_approval').
// 'rejected' is set externally by the procurement authority — the app reads it but
// never writes it from the site-crew UI.
export type DbOrderStatus = "requested" | "ordered" | "delivered" | "rejected";

// Defensive: legacy rows in the DB may still carry 'approved' / 'draft' / 'pending_approval'
// from before the migration. We accept them on read, normalize on display, and
// never echo them back on write.
export type DbOrderStatusRaw = DbOrderStatus | "approved" | "draft" | "pending_approval";

export const normalizeStatus = (s: string | null | undefined): DbOrderStatus => {
  switch (s) {
    case "requested":
    case "ordered":
    case "delivered":
    case "rejected":
      return s;
    case "approved": // legacy → merged into ordered
      return "ordered";
    case "draft":
    case "pending_approval": // legacy → maps to requested
      return "requested";
    default:
      return "requested";
  }
};

// UUID v4/v5 detection so we never send local catalog IDs to a UUID FK column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | null | undefined): s is string =>
  typeof s === "string" && UUID_RE.test(s);

export type DbOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  // Snapshot fields written at order time so historical orders survive
  // catalog edits / product deletion.
  product_name: string | null;
  unit: string | null;
  quantity: number;
  unit_price: number | null;
  // Stored generated column = quantity * unit_price. Read-only from the app.
  line_total: number | null;
  created_at: string;
  // Joined when select includes normalized_products(*)
  normalized_products?: {
    id: string;
    product_name: string | null;
    family_name: string | null;
    category: string | null;
    unit: string | null;
  } | null;
};

export type DbOrder = {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: DbOrderStatusRaw;
  project_id: string | null;
  user_id: string | null;
  site_name: string | null;
  ordered_by: string | null;
  notes: string | null;
  rejection_reason: string | null;
  // Maintained by DB trigger (tg_order_items_recalc). Always in sync with order_items.
  total_price: number | null;
  items: unknown; // legacy jsonb column, ignored in new flow
  order_items?: DbOrderItem[];
};

export type CreateOrderInput = {
  projectId: string; // must be a real projects.id UUID
  siteName?: string | null;
  orderedBy?: string | null;
  notes?: string | null;
  status?: DbOrderStatus;
  lines: CartLine[];
};

/**
 * Reads projects.min_approval for the given project.
 * Returns 0 when the project row is missing, the column is null, or any
 * error occurs — the caller treats 0 as "always auto-approve" so missing
 * config never blocks an order.
 */
export async function getProjectMinApproval(projectId: string): Promise<number> {
  if (!isUuid(projectId)) {
    console.warn("[orders] getProjectMinApproval: non-UUID projectId, defaulting to 0", { projectId });
    return 0;
  }
  const { data, error } = await supabase
    .from("projects")
    .select("min_approval")
    .eq("id", projectId)
    .maybeSingle();
  if (error) {
    console.warn("[orders] getProjectMinApproval failed, defaulting to 0", {
      projectId,
      code: error.code,
      message: error.message,
    });
    return 0;
  }
  const raw = (data as { min_approval?: number | string | null } | null)?.min_approval;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Creates one row in `orders` and one row per cart line in `order_items`.
 * Lines whose product.id is not a UUID (legacy local catalog items) are
 * skipped from order_items because order_items.product_id FKs to
 * normalized_products(id) which only accepts UUIDs.
 */
export async function createOrder(input: CreateOrderInput): Promise<DbOrder> {
  const status: DbOrderStatus = input.status ?? "requested";

  // Guard 0a — empty cart must never reach the DB.
  if (!input.lines || input.lines.length === 0) {
    const err = new Error("Cannot create an order with an empty cart.");
    console.error("[orders] createOrder aborted — empty cart", { projectId: input.projectId });
    throw err;
  }

  // Guard 0b — every line must be linkable to normalized_products.
  // We refuse to create a "ghost" order header if no line survives the UUID
  // filter, instead of inserting a header with zero order_items.
  const linesToInsert = input.lines.filter((l) => isUuid(l.product.id) && l.qty > 0);
  if (linesToInsert.length === 0) {
    const err = new Error(
      "No cart lines reference a known product. Add items from the catalog and try again.",
    );
    console.error("[orders] createOrder aborted — no linkable lines", {
      projectId: input.projectId,
      submittedCount: input.lines.length,
    });
    throw err;
  }

  // Phase 1 — insert order header.
  const orderPayload = {
    status,
    project_id: input.projectId,
    // user_id intentionally omitted: no auth wired yet, column is nullable.
    site_name: input.siteName ?? null,
    ordered_by: input.orderedBy ?? null,
    notes: input.notes ?? null,
  };
  // QA: log the exact payload sent to Supabase.
  console.info("[orders] → POST orders", orderPayload);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderErr) {
    console.error("[orders] orders insert failed", {
      code: orderErr.code,
      message: orderErr.message,
      details: orderErr.details,
      hint: orderErr.hint,
    });
    throw orderErr;
  }
  const created = order as DbOrder;
  console.info("[orders] ← orders insert ok", { id: created.id, status: created.status });

  // Phase 2 — insert order_items linked to the new order_id.
  // Full row includes snapshot columns (product_name, unit) added by the
  // 2026-04-18 orders audit migration. If that migration hasn't been run yet
  // the insert fails with PGRST204 ("Could not find the X column ... in the
  // schema cache") — we then retry with the minimal legacy schema so the app
  // keeps working until the migration is applied.
  // The full row includes audit columns added by the 2026-04-19 project
  // pricing migration: `price_source` ("project" | "contract") and
  // `project_id` (the project context the price was resolved for). When the
  // schema cache hasn't picked them up yet (PGRST204) we fall back to the
  // legacy minimal payload so the app keeps working until the migration runs.
  const fullRows = linesToInsert.map((l) => ({
    order_id: created.id,
    product_id: l.product.id,
    product_name: l.product.name ?? null,
    unit: l.product.unit ?? null,
    quantity: l.qty,
    unit_price: l.product.price > 0 ? l.product.price : null,
    price_source: l.product.priceSource ?? null,
    project_id: input.projectId,
  }));
  const legacyRows = linesToInsert.map((l) => ({
    order_id: created.id,
    product_id: l.product.id,
    quantity: l.qty,
    unit_price: l.product.price > 0 ? l.product.price : null,
  }));

  console.info("[orders] → POST order_items", {
    order_id: created.id,
    count: fullRows.length,
    rows: fullRows,
  });

  const rollbackHeader = async (reason: string) => {
    console.error("[orders] rolling back order header", { order_id: created.id, reason });
    const { error: rollbackErr } = await supabase
      .from("orders")
      .delete()
      .eq("id", created.id);
    if (rollbackErr) {
      console.error("[orders] ROLLBACK FAILED — orphan order header left in DB", {
        order_id: created.id,
        code: rollbackErr.code,
        message: rollbackErr.message,
      });
    }
  };

  let { error: itemsErr, data: insertedItems } = await supabase
    .from("order_items")
    .insert(fullRows)
    .select("id");

  // Schema-cache miss for snapshot/audit columns → retry without them.
  // Covers product_name/unit (2026-04-18 migration) and price_source/project_id
  // (2026-04-19 project-pricing migration).
  if (
    itemsErr &&
    itemsErr.code === "PGRST204" &&
    /product_name|unit|price_source|project_id/i.test(itemsErr.message ?? "")
  ) {
    console.warn(
      "[orders] order_items audit columns missing — falling back to legacy insert. " +
        "Run db/migrations/2026-04-18_orders_audit.sql and 2026-04-19_order_items_pricing.sql.",
      { message: itemsErr.message },
    );
    ({ error: itemsErr, data: insertedItems } = await supabase
      .from("order_items")
      .insert(legacyRows)
      .select("id"));
  }

  if (itemsErr) {
    console.error("[orders] order_items insert failed — rolling back order", {
      order_id: created.id,
      code: itemsErr.code,
      message: itemsErr.message,
      details: itemsErr.details,
      hint: itemsErr.hint,
    });
    await rollbackHeader("order_items insert error");
    throw itemsErr;
  }

  // Defensive: insert reported success but returned 0 rows (RLS strip, etc.) —
  // treat as failure and roll back so the UI never shows an empty order.
  const insertedCount = (insertedItems ?? []).length;
  if (insertedCount !== fullRows.length) {
    console.error("[orders] order_items insert returned wrong row count — rolling back", {
      order_id: created.id,
      expected: fullRows.length,
      got: insertedCount,
    });
    await rollbackHeader("order_items row count mismatch");
    throw new Error(
      `Order items partially saved (${insertedCount}/${fullRows.length}). Order was rolled back.`,
    );
  }

  console.info("[orders] ← order_items insert ok", {
    order_id: created.id,
    count: insertedCount,
  });

  return created;
}

/**
 * Procurement officer confirms a "Requested" order: status → "ordered".
 * No intermediate "approved" state.
 */
export async function confirmOrder(orderId: string): Promise<void> {
  console.info("[orders] → PATCH confirm", { orderId, status: "ordered" });
  const { error } = await supabase
    .from("orders")
    .update({ status: "ordered" satisfies DbOrderStatus })
    .eq("id", orderId);
  if (error) {
    console.error("[orders] confirm failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
  console.info("[orders] ← confirm ok", { orderId });
}

/**
 * Hard-delete an order. order_items are removed via ON DELETE CASCADE.
 * Caller is responsible for enforcing the 12-hour cancellation window.
 */
export async function cancelOrder(orderId: string): Promise<void> {
  console.info("[orders] → DELETE cancel", { orderId });
  // Defensive: explicitly remove children first in case the FK isn't cascading.
  const { error: itemsErr } = await supabase
    .from("order_items")
    .delete()
    .eq("order_id", orderId);
  if (itemsErr) {
    console.error("[orders] cancel: order_items delete failed", {
      orderId,
      code: itemsErr.code,
      message: itemsErr.message,
    });
    throw itemsErr;
  }
  const { error } = await supabase.from("orders").delete().eq("id", orderId);
  if (error) {
    console.error("[orders] cancel failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
  console.info("[orders] ← cancel ok", { orderId });
}

/**
 * Returns true if the order was created less than `windowHours` ago.
 */
export function isWithinCancelWindow(createdAt: string, windowHours = 12): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  const ageMs = Date.now() - created;
  return ageMs >= 0 && ageMs < windowHours * 60 * 60 * 1000;
}

/**
 * Mark an "Ordered" order as delivered.
 */
export async function markDelivered(orderId: string): Promise<void> {
  console.info("[orders] → PATCH delivered", { orderId, status: "delivered" });
  const { error } = await supabase
    .from("orders")
    .update({ status: "delivered" satisfies DbOrderStatus })
    .eq("id", orderId);
  if (error) {
    console.error("[orders] mark delivered failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }
  console.info("[orders] ← mark delivered ok", { orderId });
}

/**
 * Fetches all orders for a project, joining order_items and the linked
 * normalized_products row for each item — single round-trip.
 */
export async function listOrdersForProject(projectId: string): Promise<DbOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*, normalized_products(*))")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DbOrder[];
}
