/**
 * ConstructionAgentFAB
 * ----------------------------------------------------------------------------
 * Floating button + chat-style panel for the Bau-Assistent.
 *
 * NOTE: The kit/embedding/RPC system was removed. This now does a simple,
 * direct Supabase ILIKE search against the `normalized_products` table
 * (the project's actual products table) using the existing client. No
 * edge functions, no vectors, no sync.
 *
 * Visible only on the home page ("/").
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, Loader2, X, Plus, Package, ArrowUp, HardHat } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useApp } from "@/store/app";
import { toast } from "@/hooks/use-toast";
import {
  PRODUCT_TABLE,
  PRODUCT_SELECT,
  enrichProduct,
  type DbProduct,
} from "@/lib/productSearch";
import type { Product } from "@/data/catalog";

type ChatMessage =
  | { id: string; role: "user"; text: string; ts: number }
  | {
      id: string;
      role: "assistant";
      ts: number;
      busy?: boolean;
      error?: string | null;
      products?: DbProduct[];
      query?: string;
    };

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const escapeLike = (s: string) => s.replace(/[%_,()]/g, (m) => `\\${m}`);

export function ConstructionAgentFAB() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  const projectId = useApp((s) => s.projectId);
  const addToCart = useApp((s) => s.addToCart);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [areaInput, setAreaInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const reqIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSubmittedRef = useRef<string>("");

  // Close + unmount when navigating away from home.
  useEffect(() => {
    if (!isHomePage && open) setOpen(false);
  }, [isHomePage, open]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const submitQuery = () => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || busy) return;
    if (trimmed === lastSubmittedRef.current) return;
    lastSubmittedRef.current = trimmed;
    void runSearch(trimmed, parseArea(areaInput));
  };

  const runSearch = async (q: string, areaM2: number | null) => {
    const id = ++reqIdRef.current;
    const userMsgId = `u-${id}-${Date.now()}`;
    const assistantId = `a-${id}-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        text: areaM2 ? `${q} · ${areaM2} m²` : q,
        ts: Date.now(),
      },
      { id: assistantId, role: "assistant", ts: Date.now(), busy: true, query: q },
    ]);
    setQuery("");
    setBusy(true);

    if (!isSupabaseConfigured) {
      updateAssistant(assistantId, {
        busy: false,
        products: [],
        error: "Lovable Cloud ist nicht konfiguriert.",
      });
      setBusy(false);
      return;
    }

    try {
      const safe = escapeLike(q);
      // Use only columns we know exist on normalized_products. If a column
      // is missing, .or() simply yields no matches for that branch — it
      // does not throw — so this is safe.
      const orFilter = [
        `product_name.ilike.%${safe}%`,
        `family_name.ilike.%${safe}%`,
        `category.ilike.%${safe}%`,
        `subcategory.ilike.%${safe}%`,
      ].join(",");

      const { data, error } = await supabase
        .from(PRODUCT_TABLE)
        .select(PRODUCT_SELECT)
        .or(orFilter)
        .order("product_name", { ascending: true })
        .limit(10);

      if (id !== reqIdRef.current) return;
      if (error) throw error;

      const enriched = (data ?? []).map((row) => enrichProduct(row, projectId));
      updateAssistant(assistantId, {
        busy: false,
        products: enriched,
        query: q,
        error: null,
      });
    } catch (e) {
      if (id !== reqIdRef.current) return;
      const message = e instanceof Error ? e.message : "Suche fehlgeschlagen";
      updateAssistant(assistantId, {
        busy: false,
        products: [],
        query: q,
        error: message,
      });
    } finally {
      if (id === reqIdRef.current) setBusy(false);
    }
  };

  const updateAssistant = (
    id: string,
    patch: Partial<Extract<ChatMessage, { role: "assistant" }>>,
  ) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...patch } : m)),
    );
  };

  const addProduct = (p: DbProduct) => {
    const product: Product = {
      id: p.id,
      name: p.product_name ?? "Produkt",
      sku: p.id,
      unit: p.unit ?? "Stk",
      price: p.price ?? 0,
      category: p.category ?? "",
      subcategory: p.subcategory ?? null,
      priceSource: p.priceSource ?? undefined,
      listPrice: p.listPrice ?? null,
      supplier: p.supplierName ?? null,
    };
    addToCart(product, 1);
    toast({
      title: "Zum Projekt hinzugefügt",
      description: `${product.name} im Warenkorb.`,
    });
  };

  if (!isHomePage) return null;

  const showEmpty = messages.length === 0;

  return (
    <>
      <button
        type="button"
        aria-label="Open Construction Assistant"
        onClick={() => setOpen(true)}
        className="absolute bottom-[115px] right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
      >
        <Sparkles className="h-5 w-5" />
        <span className="text-sm font-semibold">Bau-Assistent</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex flex-col gap-0 overflow-hidden p-0"
          style={{
            height: "min(85vh, calc(100dvh - var(--ios-kb-h, 0px) - 3rem))",
            maxHeight: "calc(100dvh - var(--ios-kb-h, 0px) - 3rem)",
            transform: "translate(-50%, calc(-50% - (var(--ios-kb-h, 0px) / 2)))",
          }}
        >
          {/* Header — fixed 56px */}
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-foreground">
                  Bau-Assistent
                </p>
                <p className="flex items-center gap-1 text-[11px] leading-tight text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Online
                </p>
              </div>
            </div>
          </header>

          {/* Messages — flex-grow, scrollable */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background px-3 py-3">
            {showEmpty ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <HardHat className="h-6 w-6" />
                </span>
                <p className="text-sm font-medium text-muted-foreground">
                  Sag mir, was du auf der Baustelle brauchst.
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  z.B. Schrauben, Kabel, Dübel
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <li key={m.id} className="flex flex-col items-end">
                      <div
                        className="max-w-[80%] bg-primary px-3 py-2 text-sm text-primary-foreground"
                        style={{ borderRadius: "18px 18px 4px 18px" }}
                      >
                        {m.text}
                      </div>
                      <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                        {formatTime(m.ts)}
                      </span>
                    </li>
                  ) : (
                    <li key={m.id} className="flex flex-col items-start">
                      <div
                        className="max-w-[90%] bg-muted px-3 py-2 text-sm text-foreground"
                        style={{ borderRadius: "18px 18px 18px 4px" }}
                      >
                        {m.busy && (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Suche Produkte…
                          </span>
                        )}
                        {!m.busy && m.error && (
                          <span className="flex items-start gap-2 text-destructive">
                            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {m.error}
                          </span>
                        )}
                        {!m.busy && !m.error && (m.products?.length ?? 0) === 0 && (
                          <span className="text-muted-foreground">
                            Kein passendes Produkt gefunden.
                          </span>
                        )}
                        {!m.busy && !m.error && (m.products?.length ?? 0) > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              {m.products!.length} Produkt
                              {m.products!.length === 1 ? "" : "e"} gefunden:
                            </p>
                            {m.products!.map((p) => (
                              <ProductCard
                                key={p.id}
                                product={p}
                                onAdd={() => addProduct(p)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="mt-1 px-1 text-[10px] text-muted-foreground">
                        {formatTime(m.ts)}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>

          {/* Footer input — fixed */}
          <footer className="shrink-0 border-t border-border bg-card px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                m²
              </span>
              <Input
                inputMode="decimal"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="optional"
                className="h-7 w-20 rounded-full px-3 text-xs"
              />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitQuery();
              }}
              className="flex items-center gap-2"
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sag, was du brauchst…"
                className="h-10 flex-1 rounded-full bg-background px-4 text-sm"
                autoFocus
              />
              <button
                type="submit"
                disabled={busy || query.trim().length < 2}
                aria-label="Senden"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </form>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProductCard({
  product,
  onAdd,
}: {
  product: DbProduct;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            {product.product_name ?? "Produkt"}
          </p>
          <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            {[product.category, product.subcategory].filter(Boolean).join(" · ")}
          </p>
        </div>
        {product.price != null && product.price > 0 && (
          <span className="shrink-0 font-display text-sm">
            €{product.price.toFixed(2)}
          </span>
        )}
      </div>

      {(product.size || product.unit || product.supplierName) && (
        <ul className="mb-3 space-y-1">
          <li className="flex items-center gap-2 text-xs text-foreground">
            <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">
              {[product.size, product.unit].filter(Boolean).join(" · ")}
            </span>
            {product.supplierName && (
              <span className="shrink-0 truncate text-muted-foreground">
                {product.supplierName}
              </span>
            )}
          </li>
        </ul>
      )}

      <Button type="button" size="sm" className="w-full" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" /> Zum Projekt hinzufügen
      </Button>
    </div>
  );
}

function parseArea(input: string): number | null {
  const cleaned = input.replace(",", ".").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
