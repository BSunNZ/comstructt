import { CartLine } from "@/data/catalog";
import type { DbOrderItem } from "@/lib/orders";

/**
 * Single source of truth for "what does this order cost".
 *
 * Rules (matches QuantityRow + Cart):
 * - Lines without a known supplier price (price <= 0 / null) contribute 0.
 *   They are sent as "Preis auf Anfrage" but MUST NOT inflate or deflate the
 *   approval threshold check — treating them as 0 means a zero-priced line
 *   alone will always auto-approve, which is the safe default.
 * - Quantity is coerced to a non-negative integer.
 */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => {
    const price = Number(l.product?.price) || 0;
    const qty = Math.max(0, Number(l.qty) || 0);
    return sum + (price > 0 ? price * qty : 0);
  }, 0);
}

/** Same rule applied to persisted order_items rows. */
export function orderItemsTotal(items: DbOrderItem[] | null | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, it) => {
    const price = Number(it.unit_price) || 0;
    const qty = Math.max(0, Number(it.quantity) || 0);
    return sum + (price > 0 ? price * qty : 0);
  }, 0);
}

/**
 * Decides the initial status for a freshly-submitted order based on the
 * project's approval threshold.
 *
 * Logic:
 *   total < threshold  → "ordered"   (auto-approved)
 *   total >= threshold → "requested" (needs procurement approval)
 *
 * `threshold` of null / undefined / NaN / negative is treated as 0 → every
 * order auto-approves. This is the documented fallback for projects that
 * have not configured min_approval yet.
 */
export function decideInitialStatus(
  total: number,
  threshold: number | null | undefined,
): "requested" | "ordered" {
  const t = Number(threshold);
  const safeThreshold = Number.isFinite(t) && t > 0 ? t : 0;
  if (safeThreshold === 0) return "ordered";
  return total < safeThreshold ? "ordered" : "requested";
}
