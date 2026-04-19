import { supabase } from "@/lib/supabase";
import { CartLine } from "@/data/catalog";

// Postgres enum order_status — the canonical 3-step lifecycle.
// CREATE TYPE order_status AS ENUM ('requested', 'ordered', 'delivered');
// The app NEVER writes any other value (no 'draft', no 'approved', no 'pending_approval').
export type DbOrderStatus = "requested" | "ordered" | "delivered";

// Defensive: legacy rows in the DB may still carry 'approved' / 'draft' / 'pending_approval'
// from before the migration. We accept them on read, normalize on display, and
// never echo them back on write.
export type DbOrderStatusRaw = DbOrderStatus | "approved" | "draft" | "pending_approval";

export const normalizeStatus = (s: string | null | undefined): DbOrderStatus => {
  switch (s) {
    case "requested":
    case "ordered":
    case "delivered":
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
  const linesToInsert = input.lines.filter((l) => isUuid(l.product.id) && l.qty > 0);
  const fullRows = linesToInsert.map((l) => ({
    order_id: created.id,
    product_id: l.product.id,
    product_name: l.product.name ?? null,
    unit: l.product.unit ?? null,
    quantity: l.qty,
    unit_price: l.product.price > 0 ? l.product.price : null,
  }));
  const legacyRows = linesToInsert.map((l) => ({
    order_id: created.id,
    product_id: l.product.id,
    quantity: l.qty,
    unit_price: l.product.price > 0 ? l.product.price : null,
  }));

  console.info("[orders] → POST order_items", {
    count: fullRows.length,
    skipped: input.lines.length - fullRows.length,
    rows: fullRows,
  });

  const tryInsertItems = async () => {
    if (fullRows.length === 0) return;
    let { error: itemsErr } = await supabase.from("order_items").insert(fullRows);

    // Schema-cache miss for snapshot columns → retry without them.
    if (
      itemsErr &&
      itemsErr.code === "PGRST204" &&
      /product_name|unit/i.test(itemsErr.message ?? "")
    ) {
      console.warn(
        "[orders] order_items snapshot columns missing — falling back to legacy insert. " +
          "Run db/migrations/2026-04-18_orders_audit.sql to enable snapshots.",
        { message: itemsErr.message }
      );
      ({ error: itemsErr } = await supabase.from("order_items").insert(legacyRows));
    }

    if (itemsErr) {
      console.error("[orders] order_items insert failed — rolling back order", {
        order_id: created.id,
        code: itemsErr.code,
        message: itemsErr.message,
        details: itemsErr.details,
        hint: itemsErr.hint,
      });
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
      throw itemsErr;
    }
    console.info("[orders] ← order_items insert ok", { count: fullRows.length });
  };

  await tryInsertItems();

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
