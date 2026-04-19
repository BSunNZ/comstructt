import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  buildOrFilter,
  diversifyByFamily,
  enrichProduct,
  PRODUCT_SELECT,
  PRODUCT_TABLE,
  scoreProduct,
  tokenize,
  type DbProduct,
  type SupplierMappingRow,
} from "@/lib/productSearch";

// Re-export types so existing call sites keep working without import churn.
export type { DbProduct, SupplierMappingRow };

export type SmartSearchState = {
  results: DbProduct[];
  loading: boolean;
  error: string | null;
  configured: boolean;
};

export function useSmartProductSearch(query: string, limit = 20): SmartSearchState {
  const [state, setState] = useState<SmartSearchState>({
    results: [],
    loading: false,
    error: null,
    configured: isSupabaseConfigured,
  });
  const reqId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setState((s) => ({ ...s, results: [], loading: false, error: null }));
      return;
    }
    if (!isSupabaseConfigured) {
      setState({
        results: [],
        loading: false,
        error: "Supabase ist nicht konfiguriert.",
        configured: false,
      });
      return;
    }

    const tokens = tokenize(term);
    if (tokens.length === 0) {
      setState((s) => ({ ...s, results: [], loading: false, error: null }));
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null }));
    const myReq = ++reqId.current;

    // 300ms debounce
    const handle = window.setTimeout(async () => {
      try {
        const orFilter = buildOrFilter(tokens);
        const { data, error } = await supabase
          .from(PRODUCT_TABLE)
          .select(PRODUCT_SELECT)
          .or(orFilter)
          .limit(Math.max(limit * 5, 80));

        if (myReq !== reqId.current) return;

        if (error) {
          setState({ results: [], loading: false, error: error.message, configured: true });
          return;
        }

        const enriched = (data ?? []).map(enrichProduct);

        const ranked = enriched
          .map((p) => ({ p, score: scoreProduct(p, tokens) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score);

        const final = diversifyByFamily(ranked, limit);

        setState({ results: final, loading: false, error: null, configured: true });
      } catch (e: unknown) {
        if (myReq !== reqId.current) return;
        const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
        setState({ results: [], loading: false, error: msg, configured: true });
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [query, limit]);

  return state;
}
