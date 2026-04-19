import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Product } from "@/data/catalog";
import type { DbProduct } from "@/hooks/useSmartProductSearch";

/**
 * Fetches the most recent DISTINCT products ordered for the given project.
 * Joins orders → order_items → normalized_products and de-dupes by product
 * id, keeping the most recent occurrence. Returns up to `limit` products
 * along with the original ordered quantity (for the 1-click reorder button).
 *
 * Returns empty array if:
 *  - Supabase is not configured
 *  - projectId is missing
 *  - No orders exist for this project
 *  - Query errors (logged to console)
 */
export type RecentOrderedProduct = {
  product: Product;
  lastQty: number;
};

type Row = {
  quantity: number | null;
  unit_price: number | null;
  product_name: string | null;
  unit: string | null;
  created_at: string;
  product_id: string | null;
  normalized_products: DbProduct | null;
  orders: { created_at: string; project_id: string | null } | null;
};

export function useRecentOrderedProducts(projectId: string | null | undefined, limit = 6) {
  const [items, setItems] = useState<RecentOrderedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // Pull recent order_items for this project, joined with the product.
        // We sort by order_items.created_at desc and grab a generous window
        // so post-dedupe we still have `limit` distinct products.
        const { data, error: qErr } = await supabase
          .from("order_items")
          .select(
            "quantity, unit_price, product_name, unit, created_at, product_id, " +
              "normalized_products(*), orders!inner(created_at, project_id)",
          )
          .eq("orders.project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(limit * 5);

        if (qErr) throw qErr;

        const rows = (data ?? []) as unknown as Row[];
        const seen = new Set<string>();
        const out: RecentOrderedProduct[] = [];

        for (const r of rows) {
          const np = r.normalized_products;
          if (!np) continue;
          const id = String(np.id);
          if (seen.has(id)) continue;
          seen.add(id);

          const product: Product = {
            id,
            name: r.product_name ?? np.product_name ?? np.family_name ?? "Unbenanntes Produkt",
            sku: np.family_key ?? id,
            unit: r.unit ?? np.unit ?? "Stk",
            price: typeof r.unit_price === "number" && r.unit_price > 0 ? r.unit_price : 0,
            category: np.category ?? "Allgemein",
            subcategory: np.subcategory ?? null,
          };

          out.push({ product, lastQty: Number(r.quantity) > 0 ? Number(r.quantity) : 1 });
          if (out.length >= limit) break;
        }

        if (!cancelled) setItems(out);
      } catch (e) {
        const msg = (e as Error)?.message ?? "Failed to load recent orders";
        console.error("[useRecentOrderedProducts] failed", e);
        if (!cancelled) {
          setError(msg);
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [projectId, limit]);

  return { items, loading, error };
}
