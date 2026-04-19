import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Product, CartLine } from "@/data/catalog";
import type { DbProduct } from "@/hooks/useSmartProductSearch";

export type RecentOrderedProduct = {
  product: Product;
  lastQty: number;
  lastOrderedAt: string;
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

export const recentOrderedQueryKey = (projectId: string | null | undefined, limit = 8) => [
  "recent-ordered-products",
  projectId ?? null,
  limit,
] as const;

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

function mapRowToRecentProduct(r: Row): RecentOrderedProduct | null {
  const np = r.normalized_products;
  if (!np) return null;
  const id = String(np.id);
  return {
    product: {
      id,
      name: r.product_name ?? np.product_name ?? np.family_name ?? "Unbenanntes Produkt",
      sku: np.family_key ?? id,
      unit: r.unit ?? np.unit ?? "Stk",
      price: typeof r.unit_price === "number" && r.unit_price > 0 ? r.unit_price : 0,
      category: np.category ?? "Allgemein",
      subcategory: np.subcategory ?? null,
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
  const { data, error } = await supabase
    .from("order_items")
    .select(
      "quantity, unit_price, product_name, unit, created_at, product_id, " +
        "normalized_products(*), orders!inner(created_at, project_id)",
    )
    .eq("orders.project_id", projectId)
    .gte("orders.created_at", sinceIso)
    .order("created_at", { foreignTable: "orders", ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit * 8);

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
    const mapped = mapRowToRecentProduct(row);
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
  };
}
