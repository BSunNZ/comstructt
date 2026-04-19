import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Props = {
  productId: string;
  open: boolean;
  onToggle: () => void;
};

// Foreman-facing whitelist: only fields that help decide if this is the
// right material for the job. Order here = display order. Backend metadata
// (confidence_score, catalog_status, is_c_material, hazardous, is_hazmat,
// family_key, variant_attributes, etc.) is intentionally excluded.
const VISIBLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "brand", label: "Brand" },
  { key: "source_name", label: "Brand" }, // fallback when no dedicated brand column
  { key: "category", label: "Category" },
  { key: "consumption_type", label: "Consumption Type" },
  { key: "storage_location", label: "Storage Location" },
  { key: "typical_site", label: "Typical Site" },
];

// Decide whether a value is worth showing.
const isDisplayable = (v: unknown): v is string | number | boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  return false;
};

const formatValue = (v: string | number | boolean): string => {
  if (typeof v === "boolean") return v ? "Ja" : "Nein";
  return String(v);
};

/**
 * Inline collapsible "Details" footer for a product card on the search
 * results page. Fetches the full Supabase row on first expand and renders
 * every non-empty scalar column dynamically — no hardcoded attribute names.
 */
export const ProductDetailDropdown = ({ productId, open, onToggle }: Props) => {
  const [attrs, setAttrs] = useState<Array<[string, string]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from("normalized_products")
          .select("*")
          .eq("id", productId)
          .maybeSingle();
        if (err) throw err;
        if (!data) {
          setAttrs([]);
          return;
        }
        const rows: Array<[string, string]> = [];
        const seenLabels = new Set<string>();
        const record = data as Record<string, unknown>;
        for (const { key, label } of VISIBLE_FIELDS) {
          if (seenLabels.has(label)) continue; // brand fallback: skip source_name if brand already added
          const value = record[key];
          if (!isDisplayable(value)) continue;
          rows.push([label, formatValue(value)]);
          seenLabels.add(label);
        }
        setAttrs(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Laden");
        setAttrs([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, productId]);

  // Measure the rendered content height in a layout effect so the value is
  // available BEFORE the browser paints. Re-measure whenever open, loading,
  // attrs, or error change — these are the only inputs that affect the
  // content's intrinsic height. Without this, the first click reads a stale
  // scrollHeight (0) and the panel only fully expands on the second click.
  const [maxH, setMaxH] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setMaxH(0);
      return;
    }
    const measure = () => {
      if (contentRef.current) setMaxH(contentRef.current.scrollHeight);
    };
    measure();
    // Re-measure on the next frame too — covers fonts/icons that settle
    // their own size after the first paint.
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [open, loading, attrs, error]);

  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground active:bg-muted"
      >
        <span>Details</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        style={{
          maxHeight: maxH,
          transition: "max-height 200ms ease",
        }}
        className="overflow-hidden"
      >
        <div ref={contentRef} className="pt-2">
          {loading && (
            <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Lade Details…</span>
            </div>
          )}
          {error && (
            <p className="px-1 py-1 text-xs text-destructive">Fehler: {error}</p>
          )}
          {!loading && !error && attrs && attrs.length === 0 && (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              Keine weiteren Details verfügbar
            </p>
          )}
          {!loading && !error && attrs && attrs.length > 0 && (
            <dl className="w-full divide-y divide-border/60">
              {attrs.map(([label, value]) => (
                <div
                  key={label}
                  className="grid w-full grid-cols-[40%_60%] gap-2 py-1.5 text-xs"
                >
                  <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 overflow-hidden break-all font-medium text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
};
