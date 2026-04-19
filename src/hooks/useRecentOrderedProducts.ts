import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Product, CartLine } from "@/data/catalog";
import type { DbProduct } from "@/hooks/useSmartProductSearch";
import { enrichProduct } from "@/lib/productSearch";

export type RecentOrderedProduct = {
  product: Product;
  lastQty: number;
  lastOrderedAt: string;
};

type Row = {
  quantity: number | null;
  unit_price: number | null;
  // Snapshot columns on order_items only exist if those migrations have
  // been applied. Both are optional — we always fall back to the joined
  // normalized_products row.
  product_name?: string | null;
  unit?: string | null;
  supplier_name?: string | null;
  created_at: string;
  product_id: string | null;
  // normalized_products(*) plus the joined supplier mapping so we can
  // recompute the active supplier when the snapshot column is missing.
  normalized_products: (DbProduct & { id: string }) | null;
  orders: { created_at: string; project_id: string | null } | null;
};

export const recentOrderedQueryKey = (projectId: string | null | undefined, limit = 8) => [
  "recent-ordered-products",
  projectId ?? null,
  limit,
] as const;

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

function mapRowToRecentProduct(
  r: Row,
  projectId: string | null | undefined,
): RecentOrderedProduct | null {
  const np = r.normalized_products;
  if (!np) return null;
  const id = String(np.id);
  // Re-enrich the joined product so we get the same supplier resolution
  // as the live search. Falls back to the snapshot supplier_name on the
  // order_items row when the join didn't surface a mapping.
  const enriched = enrichProduct(np, projectId ?? null);
  return {
    product: {
      id,
      name: r.product_name ?? np.product_name ?? np.family_name ?? "Unbenanntes Produkt",
      sku: np.family_key ?? id,
      unit: r.unit ?? np.unit ?? "Stk",
      price: typeof r.unit_price === "number" && r.unit_price > 0 ? r.unit_price : 0,
      category: np.category ?? "Allgemein",
      subcategory: np.subcategory ?? null,
      supplier: r.supplier_name ?? enriched.supplierName ?? null,
    },
    lastQty: Number(r.quantity) > 0 ? Number(r.quantity) : 1,
    lastOrderedAt: r.orders?.created_at ?? r.created_at,
  };
}

export async function fetchRecentOrderedProducts(
  projectId: string | null | undefined,
  limit = 8,
): Promise<RecentOrderedProduct[]> {
  if (!isSupabaseConfigured || !projectId) return [];

  const sinceIso = new Date(Date.now() - DAYS_30_MS).toISOString();
  // Snapshot columns added by later migrations. We probe progressively:
  // if a column doesn't exist (42703 / PGRST204), drop it and retry.
  // The minimum select always includes the join to normalized_products
  // so we never lose product name / supplier even on a fresh DB.
  const optionalCols = ["supplier_name", "product_name", "unit"];
  const baseRequiredSelect =
    "quantity, unit_price, created_at, product_id, " +
    "normalized_products(*, supplier_product_mapping(contract_price, project_prices, supplier_id, suppliers(name))), " +
    "orders!inner(created_at, project_id)";

  const runQuery = async (cols: string[]) => {
    const select = cols.length > 0 ? `${cols.join(", ")}, ${baseRequiredSelect}` : baseRequiredSelect;
    return supabase
      .from("order_items")
      .select(select)
      .eq("orders.project_id", projectId)
      .gte("orders.created_at", sinceIso)
      .order("created_at", { foreignTable: "orders", ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit * 8);
  };

  let cols = [...optionalCols];
  let data: unknown = null;
  let error: { code?: string; message?: string; details?: string | null; hint?: string | null } | null = null;

  // Up to N attempts — drop one offending column per failure.
  for (let attempt = 0; attempt < optionalCols.length + 1; attempt++) {
    const res = await runQuery(cols);
    data = res.data;
    error = res.error;
    if (!error) break;

    const isMissingCol = error.code === "PGRST204" || error.code === "42703";
    if (!isMissingCol) break;

    // Find which optional column the error mentions; remove it and retry.
    const offending = cols.find((c) => new RegExp(`\\b${c}\\b`, "i").test(error?.message ?? ""));
    if (!offending) break;
    console.warn(
      `[recent-ordered] dropping missing column "${offending}" and retrying. ` +
        `Apply the matching migration to enable richer snapshots.`,
    );
    cols = cols.filter((c) => c !== offending);
  }

  if (error) {
    console.error("[recent-ordered] query failed", {
      projectId,
      limit,
      sinceIso,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }

  const rows = (data ?? []) as unknown as Row[];
  const seen = new Set<string>();
  const out: RecentOrderedProduct[] = [];

  for (const row of rows) {
    const mapped = mapRowToRecentProduct(row, projectId);
    if (!mapped) continue;
    if (seen.has(mapped.product.id)) continue;
    seen.add(mapped.product.id);
    out.push(mapped);
    if (out.length >= limit) break;
  }

  return out;
}

export function buildOptimisticRecentProducts(lines: CartLine[]): RecentOrderedProduct[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: RecentOrderedProduct[] = [];

  for (const line of lines) {
    if (!line?.product?.id || seen.has(line.product.id)) continue;
    seen.add(line.product.id);
    out.push({
      product: line.product,
      lastQty: Math.max(1, Number(line.qty) || 1),
      lastOrderedAt: now,
    });
  }

  return out;
}

export function mergeRecentOrderedProducts(
  optimistic: RecentOrderedProduct[],
  existing: RecentOrderedProduct[] | undefined,
  limit = 8,
): RecentOrderedProduct[] {
  const merged = [...optimistic, ...(existing ?? [])];
  const seen = new Set<string>();
  const out: RecentOrderedProduct[] = [];

  for (const item of merged) {
    if (!item?.product?.id || seen.has(item.product.id)) continue;
    seen.add(item.product.id);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}

export function useRecentOrderedProducts(projectId: string | null | undefined, limit = 8) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: recentOrderedQueryKey(projectId, limit),
    queryFn: () => fetchRecentOrderedProducts(projectId, limit),
    enabled: Boolean(isSupabaseConfigured && projectId),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
    refetch: query.refetch,
    setOptimistic: (optimisticLines: CartLine[]) => {
      const optimistic = buildOptimisticRecentProducts(optimisticLines);
      queryClient.setQueryData<RecentOrderedProduct[]>(
        recentOrderedQueryKey(projectId, limit),
        (current) => mergeRecentOrderedProducts(optimistic, current, limit),
      );
    },
    // Clears the locally-cached "recently ordered" list for this project.
    // We don't delete order history from the DB — this just empties the
    // visible section until the next refetch (e.g. after a new order).
    clearLocal: () => {
      queryClient.setQueryData<RecentOrderedProduct[]>(
        recentOrderedQueryKey(projectId, limit),
        [],
      );
    },
  };
}
