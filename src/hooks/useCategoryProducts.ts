import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { enrichProduct, PRODUCT_SELECT, PRODUCT_TABLE, type DbProduct } from "@/lib/productSearch";

type State<T> = { data: T; loading: boolean; error: string | null };

/**
 * Live-fetch all distinct subcategories for a given top-level category.
 * Sorted alphabetically; null/empty values are dropped. Used to render
 * the subcategory grid on /category/:cat.
 */
export function useSubcategories(categoryDbValue: string | null): State<string[]> {
  const [state, setState] = useState<State<string[]>>({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!categoryDbValue || !isSupabaseConfigured) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const { data, error } = await supabase
        .from(PRODUCT_TABLE)
        .select("subcategory")
        .eq("category", categoryDbValue)
        .limit(2000);
      if (!alive) return;
      if (error) {
        setState({ data: [], loading: false, error: error.message });
        return;
      }
      const set = new Set<string>();
      for (const row of (data ?? []) as { subcategory: string | null }[]) {
        const v = (row.subcategory ?? "").trim();
        if (v) set.add(v);
      }
      setState({ data: Array.from(set).sort((a, b) => a.localeCompare(b, "de")), loading: false, error: null });
    })();
    return () => {
      alive = false;
    };
  }, [categoryDbValue]);

  return state;
}

/**
 * Live-fetch all products for a (category, subcategory) pair, enriched with
 * project-aware pricing + supplier — same shape the smart search uses.
 */
export function useProductsBySubcategory(
  categoryDbValue: string | null,
  subcategory: string | null,
  projectId: string | null | undefined,
): State<DbProduct[]> {
  const [state, setState] = useState<State<DbProduct[]>>({ data: [], loading: false, error: null });

  useEffect(() => {
    if (!categoryDbValue || !subcategory || !isSupabaseConfigured) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const { data, error } = await supabase
        .from(PRODUCT_TABLE)
        .select(PRODUCT_SELECT)
        .eq("category", categoryDbValue)
        .eq("subcategory", subcategory)
        .order("product_name", { ascending: true })
        .limit(200);
      if (!alive) return;
      if (error) {
        setState({ data: [], loading: false, error: error.message });
        return;
      }
      const enriched = (data ?? []).map((row) => enrichProduct(row, projectId ?? null));
      // Dedupe by product_name (the catalog has duplicates across suppliers).
      const seen = new Set<string>();
      const unique: DbProduct[] = [];
      for (const p of enriched) {
        const key = (p.product_name ?? p.id).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
      }
      setState({ data: unique, loading: false, error: null });
    })();
    return () => {
      alive = false;
    };
  }, [categoryDbValue, subcategory, projectId]);

  return state;
}