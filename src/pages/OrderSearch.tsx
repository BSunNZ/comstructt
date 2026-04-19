import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { Search, ShoppingCart, Plus, Minus, Repeat, MapPin, Sparkles, X, Loader2, ClipboardList, Mic, MicOff, Send } from "lucide-react";
import { useApp } from "@/store/app";
import { isBanned, LAST_ORDER, PROJECTS, Product } from "@/data/catalog";
import { MisuseDialog } from "@/components/MisuseDialog";
import { useSmartProductSearch, DbProduct } from "@/hooks/useSmartProductSearch";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { SubcategoryIcon } from "@/components/SubcategoryIcon";
import { parseVoiceOrderMulti } from "@/lib/voiceOrderMulti";
import { resolveVoiceProduct } from "@/lib/voiceOrderResolver";
import { QuantitySelector } from "@/components/QuantitySelector";
import { toast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { classifyMaterial, type MaterialClass } from "@/utils/materialClassifier";
import { MaterialWarningTooltip } from "@/components/MaterialWarningTooltip";
import { OrderInfoPopover } from "@/components/OrderInfoPopover";
import { ProductDetailDropdown } from "@/components/ProductDetailDropdown";

// Map a Supabase normalized_products row into the local Product shape used by the cart.
// Price is sourced from supplier_product_mapping (lowest active). 0 means
// "no price available" → UI renders "Preis auf Anfrage".
const toProduct = (r: DbProduct): Product => ({
  id: String(r.id),
  name: r.product_name ?? r.family_name ?? "Unbenanntes Produkt",
  sku: r.family_key ?? String(r.id),
  unit: r.unit ?? "Stk",
  price: typeof r.price === "number" && r.price > 0 ? r.price : 0,
  category: r.category ?? "Allgemein",
  subcategory: r.subcategory ?? null,
});

const OrderSearch = () => {
  const nav = useNavigate();
  const cart = useApp((s) => s.cart);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const projectId = useApp((s) => s.projectId);
  const addToCart = useApp((s) => s.addToCart);
  const updateQty = useApp((s) => s.updateQty);
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0];

  const [q, setQ] = useState("");
  const [misuse, setMisuse] = useState<string | null>(null);
  // Only one product card's detail dropdown can be open at a time.
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  // Per-card draft quantity for the "+ ADD" → quantity selector → "ADD TO CART" flow.
  // While a product id is in this map, the card shows the quantity selector +
  // "ADD TO CART" button instead of the "+ ADD" button. The value is the draft
  // quantity that will be added to the cart on confirm. Cleared after add.
  const [draftQtys, setDraftQtys] = useState<Record<string, number>>({});

  const qtyFor = (id: string) => cart.find((l) => l.product.id === id)?.qty ?? 0;

  // ── Voice-shortcut state ─────────────────────────────────────────────
  // Multi-item voice flow: the user says e.g. "Order 500 screws, 20 gloves,
  // 10 WD-40". We parse that into a queue of {phrase, qty} items, then
  // resolve them one-by-one against Supabase. Confident matches are added
  // straight to the cart; ambiguous ones pause the loop and surface the
  // existing disambiguation sheet — once the user picks, we auto-advance.
  type PendingItem = { phrase: string; qty: number };
  type AmbiguousCtx = {
    candidates: DbProduct[];
    phrase: string;
    qty: number;
    /** 1-based position of the CURRENT item in the original parsed list. */
    position: number;
    /** Total items in the original parsed list. */
    total: number;
  };
  // Only `voiceAmbiguous` and `voiceResolving` are rendered. The queue
  // itself lives in refs so the async loop never reads stale React state.
  const [voiceAmbiguous, setVoiceAmbiguous] = useState<AmbiguousCtx | null>(null);
  const [voiceResolving, setVoiceResolving] = useState(false);
  const queueRef = useRef<PendingItem[]>([]);
  const totalRef = useRef(0);
  const addedRef = useRef(0);
  const failedRef = useRef<string[]>([]);

  // Debounced material classification of the typed query.
  // Drives an inline warning under the search bar AND disables Add buttons
  // when the query points at planned-procurement materials (A/B).
  const [materialClass, setMaterialClass] = useState<MaterialClass>("unknown");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setMaterialClass("unknown");
      return;
    }
    const t = window.setTimeout(() => {
      setMaterialClass(classifyMaterial(term));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const isPlannedProcurement = materialClass === "A_B";

  const onTypeChange = (val: string) => {
    setQ(val);
    const banned = isBanned(val);
    if (banned) setMisuse(banned);
  };

  const bannedTerm = isBanned(q.trim());
  const searchTerm = !bannedTerm ? q : "";
  const { results: dbResults, loading, error, configured } = useSmartProductSearch(searchTerm, 20);

  // When the typed query is a planned-procurement (A/B) material, suppress
  // ALL product cards — even loose Supabase matches — so the user only sees
  // the warning tooltip and the empty-state message. This prevents phantom
  // cards with disabled "Procurement-System" buttons.
  const visibleDbResults = isPlannedProcurement ? [] : dbResults;

  const results = useMemo<Product[]>(() => visibleDbResults.map(toProduct), [visibleDbResults]);
  const supplierByProduct = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of visibleDbResults) m.set(String(r.id), r.supplierName ?? null);
    return m;
  }, [visibleDbResults]);

  // Skip lines without a known price from the running total.
  const total = cart.reduce((s, l) => s + (l.product.price > 0 ? l.product.price * l.qty : 0), 0);

  /**
   * Resolve a single voice item against Supabase. Returns:
   *  - "added"     → confident match was auto-added to the cart.
   *  - "ambiguous" → caller must surface the disambiguation sheet and stop
   *                  the loop until the user picks.
   *  - "skipped"   → no match / banned / error; caller continues.
   */
  const resolveOneItem = useCallback(
    async (
      item: PendingItem,
      position: number,
      total: number,
    ): Promise<"added" | "ambiguous" | "skipped"> => {
      // Banned terms still apply, even via voice.
      const banned = isBanned(item.phrase);
      if (banned) {
        setMisuse(banned);
        failedRef.current = [...failedRef.current, item.phrase];
        return "skipped";
      }

      try {
        const result = await resolveVoiceProduct(item.phrase);

        if (result.kind === "none") {
          failedRef.current = [...failedRef.current, item.phrase];
          return "skipped";
        }

        if (result.kind === "match") {
          const product = toProduct(result.best);
          // Cart store de-dupes by product id and accumulates qty.
          addToCart(product, item.qty);
          addedRef.current += 1;
          return "added";
        }

        // Ambiguous — surface the sheet and pause the loop.
        setVoiceAmbiguous({
          candidates: result.candidates,
          phrase: item.phrase,
          qty: item.qty,
          position,
          total,
        });
        return "ambiguous";
      } catch (e) {
        console.error("[voice] resolve failed", e);
        toast({
          title: "Sprachsuche fehlgeschlagen",
          description: (e as Error)?.message ?? "Bitte erneut versuchen.",
          variant: "destructive",
        });
        failedRef.current = [...failedRef.current, item.phrase];
        return "skipped";
      }
    },
    [addToCart],
  );

  /**
   * Drive the queue forward until either it's empty or we hit an
   * ambiguous item (which pauses for user input). Safe to call from any
   * continuation point — it always reads from `queueRef.current`.
   */
  const processQueue = useCallback(async () => {
    setVoiceResolving(true);
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current[0];
        const position = totalRef.current - queueRef.current.length + 1;
        const status = await resolveOneItem(next, position, totalRef.current);

        if (status === "ambiguous") {
          // Keep the item at the front; sheet handler will shift it
          // off when the user picks (or skips).
          return;
        }

        // added / skipped → drop from queue and continue.
        queueRef.current = queueRef.current.slice(1);
      }

      // Queue drained — show summary and route to cart if anything was added.
      finalizeVoiceSession();
    } finally {
      setVoiceResolving(false);
    }
    // resolveOneItem is stable via useCallback; finalizeVoiceSession is
    // declared below but captured by closure — we intentionally omit it
    // from deps to avoid a circular initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveOneItem]);

  const finalizeVoiceSession = useCallback(() => {
    const added = addedRef.current;
    const failed = failedRef.current;

    if (added === 0 && failed.length === 0) return;

    if (added > 0) {
      const failedSuffix =
        failed.length > 0
          ? ` ${failed.length} nicht gefunden: „${failed.join("\", \"")}".`
          : "";
      toast({
        title: `${added} Produkt${added === 1 ? "" : "e"} im Warenkorb`,
        description: `Per Sprachbefehl hinzugefügt.${failedSuffix}`,
      });
      // Reset session counters before navigating away.
      addedRef.current = 0;
      failedRef.current = [];
      totalRef.current = 0;
      nav("/cart");
      return;
    }

    // Nothing added, only failures.
    toast({
      title: "Kein Produkt gefunden",
      description: `Keine Treffer für: „${failed.join("\", \"")}". Bitte manuell suchen.`,
      variant: "destructive",
    });
    addedRef.current = 0;
    failedRef.current = [];
    totalRef.current = 0;
  }, [nav]);

  /**
   * Voice → cart shortcut. Parses a (possibly multi-item) order phrase,
   * seeds the queue, and starts processing.
   *
   * Single-item utterances still round-trip through this exact pipeline
   * — the queue just contains one entry — so existing behaviour is
   * preserved.
   */
  const handleVoiceFinal = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const multi = parseVoiceOrderMulti(trimmed);

    // Not an order at all → drop into the search field as dictation.
    if (!multi.isOrder || multi.items.length === 0) {
      onTypeChange(trimmed);
      return;
    }

    // Show the FIRST phrase in the search field for visual context while
    // we resolve. (For multi-item commands the search field becomes
    // somewhat decorative; the queue drives the real flow.)
    onTypeChange(multi.items[0].productPhrase);

    // Reset session state and seed the queue.
    queueRef.current = multi.items.map((i) => ({ phrase: i.productPhrase, qty: i.quantity }));
    totalRef.current = multi.items.length;
    addedRef.current = 0;
    failedRef.current = [];
    setVoiceAmbiguous(null);

    await processQueue();
  };

  // Voice input — pushes the final transcript into the order pipeline above.
  const {
    supported: voiceSupported,
    listening,
    interim,
    error: voiceError,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceInput({
    lang: "de-DE",
    onFinal: handleVoiceFinal,
  });

  const toggleVoice = () => {
    if (!voiceSupported) return;
    if (listening) stopVoice();
    else startVoice();
  };

  const submitSearch = () => {
    // Search is already live via the hook; nothing to do.
  };

  /**
   * User picked a candidate from the disambiguation sheet. Add it,
   * close the sheet, advance the queue.
   */
  const pickVoiceCandidate = async (p: DbProduct) => {
    if (!voiceAmbiguous) return;
    const qty = voiceAmbiguous.qty;
    addToCart(toProduct(p), qty);
    addedRef.current += 1;

    // Drop the resolved item from the queue and clear the sheet.
    queueRef.current = queueRef.current.slice(1);
    setVoiceAmbiguous(null);

    // Continue processing the rest of the queue (if any).
    await processQueue();
  };

  /**
   * User dismissed the disambiguation sheet without picking. Treat as
   * "skip this item" and continue with the next.
   */
  const skipAmbiguousItem = async () => {
    if (!voiceAmbiguous) return;
    failedRef.current = [...failedRef.current, voiceAmbiguous.phrase];
    queueRef.current = queueRef.current.slice(1);
    setVoiceAmbiguous(null);
    await processQueue();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        title="Order"
        right={
          <div className="flex items-center gap-1.5">
            <Link
              to="/order/status"
              className="flex h-9 items-center gap-1 whitespace-nowrap rounded-lg bg-primary px-2.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
              aria-label="View my orders"
            >
              <ClipboardList className="h-4 w-4" />
              <span>My Orders</span>
            </Link>
            <OrderInfoPopover />
          </div>
        }
      />

      <main className="mx-auto max-w-md px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)_+_7rem] [padding-bottom:calc(env(safe-area-inset-bottom)+7.5rem)]">
        {/* Active site context */}
        <Link
          to="/sites"
          className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-rugged ring-1 ring-border active:translate-y-0.5"
          aria-label="Switch site"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
            <MapPin className="h-5 w-5" />
          </span>
          <span className="flex-1 leading-tight">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Current Site
            </span>
            <span className="block truncate font-display text-base font-semibold text-foreground">
              {project.name}
            </span>
          </span>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-secondary-foreground">
            {project.trade}
          </span>
        </Link>

        {/* Big central search with voice + submit */}
        <div className="mt-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
            className="relative"
            role="search"
          >
            <Search className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
            <input
              value={listening && interim ? interim : q}
              onChange={(e) => onTypeChange(e.target.value)}
              placeholder={listening ? "Höre zu…" : "Material suchen…"}
              aria-label="Search materials"
              className={`block h-16 w-full rounded-2xl border-2 bg-card pl-14 pr-32 text-base font-medium shadow-rugged outline-none placeholder:text-muted-foreground focus:border-primary ${
                listening ? "border-primary" : "border-border"
              }`}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {q && !listening && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground active:bg-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
                title={voiceSupported ? "Voice input" : "Voice input not supported"}
                className={`tap-target grid h-12 w-12 place-items-center rounded-xl transition active:translate-y-0.5 ${
                  listening
                    ? "animate-pulse bg-primary text-primary-foreground shadow-press"
                    : "bg-secondary text-secondary-foreground active:bg-white/10"
                } ${!voiceSupported ? "opacity-50" : ""}`}
              >
                {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                type="submit"
                aria-label="Submit search"
                disabled={q.trim().length === 0}
                className="tap-target grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-press active:translate-y-0.5 disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </form>

          {/* Voice status hints */}
          {(listening || voiceError || voiceResolving) && (
            <p
              role="status"
              aria-live="polite"
              className={`mt-2 px-1 text-xs ${voiceError ? "text-destructive" : "text-muted-foreground"}`}
            >
              {voiceError
                ? `Sprachfehler: ${voiceError}`
                : voiceResolving
                  ? "Suche passendes Produkt…"
                  : interim
                    ? `Gehört: „${interim}"`
                    : "Höre zu… bitte sprechen."}
            </p>
          )}

          {/* Material classification hint (A/B → procurement warning, C → ok badge) */}
          <MaterialWarningTooltip classification={materialClass} />
        </div>

        {/* Live results */}
        {q.trim().length >= 2 && (
          <section className="mt-5 space-y-3" aria-label="Search results">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Suche läuft…</span>
              </div>
            )}

            {!configured ? (
              <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">
                Supabase ist nicht verbunden. Bitte <code>VITE_SUPABASE_URL</code> und{" "}
                <code>VITE_SUPABASE_ANON_KEY</code> setzen.
              </p>
            ) : error ? (
              error.toLowerCase().includes("could not find the table") ? (
                <div className="rounded-xl bg-warning/10 p-4 text-center text-sm text-foreground">
                  <p className="font-semibold">Produkt-Datenbank nicht gefunden.</p>
                  <p className="mt-1 text-muted-foreground">
                    Die Tabelle <code>products</code> existiert noch nicht. Bitte CSV importieren oder Tabelle anlegen.
                  </p>
                </div>
              ) : (
                <p className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">
                  Fehler: {error}
                </p>
              )
            ) : loading && results.length === 0 ? (
              <p className="rounded-xl bg-muted p-4 text-center text-muted-foreground">
                Suche läuft…
              </p>
            ) : results.length === 0 ? (
              <p className="rounded-xl bg-muted p-4 text-sm leading-relaxed text-muted-foreground">
                Kein C-Material mit diesem Namen gefunden.
                <br />
                Suchst du nach einem Hauptbaustoff wie Beton oder Stahl? Diese werden über das Procurement-System bestellt.
              </p>
            ) : (
              results.map((p) => {
                const qty = qtyFor(p.id);
                return (
                  <article
                    key={p.id}
                    className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-16 w-16 shrink-0 place-items-center">
                        <SubcategoryIcon
                          subcategory={p.subcategory}
                          category={p.category}
                          className="h-14 w-14"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-tight text-foreground">{p.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.sku} · {p.unit}
                        </p>
                        {p.price > 0 ? (
                          <p className="mt-1 font-display text-xl text-foreground">
                            €{p.price.toFixed(2)}
                            <span className="ml-1 text-sm font-normal text-muted-foreground">
                              / {p.unit}
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 font-display text-base text-muted-foreground">
                            Preis auf Anfrage
                          </p>
                        )}
                        {supplierByProduct.get(p.id) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Lieferant: {supplierByProduct.get(p.id)}
                          </p>
                        )}
                      </div>
                    </div>

                    {(() => {
                      const draft = draftQtys[p.id];
                      const inDraft = draft !== undefined;

                      if (qty > 0 && !inDraft) {
                        // Already in cart → show selector to update cart qty live.
                        return (
                          <div className="mt-3">
                            <QuantitySelector
                              qty={qty}
                              onChange={(n) => updateQty(p.id, n)}
                              size="lg"
                              label={p.name}
                            />
                          </div>
                        );
                      }

                      if (!inDraft) {
                        // Initial state: show "+ ADD" button.
                        return (
                          <button
                            onClick={() =>
                              setDraftQtys((prev) => ({ ...prev, [p.id]: 1 }))
                            }
                            className="tap-target mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
                          >
                            <Plus className="h-5 w-5" /> Add
                          </button>
                        );
                      }

                      // Interaction state: ADD TO CART button stacked above quantity selector.
                      return (
                        <div className="mt-3 flex flex-col gap-3">
                          <button
                            onClick={() => {
                              if (draft <= 0) return;
                              addToCart(p, draft);
                              setDraftQtys((prev) => {
                                const next = { ...prev };
                                delete next[p.id];
                                return next;
                              });
                              toast({ title: "Item added", description: `${draft}× ${p.name}` });
                            }}
                            disabled={draft <= 0}
                            className="tap-target flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5 disabled:opacity-50 disabled:active:translate-y-0"
                          >
                            <ShoppingCart className="h-5 w-5" /> Add to cart
                          </button>
                          <QuantitySelector
                            qty={draft}
                            onChange={(n) =>
                              setDraftQtys((prev) => ({ ...prev, [p.id]: Math.max(0, n) }))
                            }
                            size="lg"
                            label={p.name}
                          />
                        </div>
                      );
                    })()}

                    <ProductDetailDropdown
                      productId={p.id}
                      open={openDetailId === p.id}
                      onToggle={() =>
                        setOpenDetailId((prev) => (prev === p.id ? null : p.id))
                      }
                    />
                  </article>
                );
              })
            )}
          </section>
        )}

        {/* Last ordered on this site — 1-click reorder */}
        {q.trim().length < 2 && (
          <section className="mt-6 space-y-3" aria-label="Recently ordered">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Recently ordered on this site
              </h2>
              <Link to="/reorder" className="text-xs font-semibold text-primary">
                View all
              </Link>
            </div>

            {LAST_ORDER.map((line) => {
              const p = line.product;
              const qty = qtyFor(p.id);
              return (
                <article
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-rugged ring-1 ring-border"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center">
                    <SubcategoryIcon
                      subcategory={p.subcategory}
                      category={p.category}
                      className="h-12 w-12"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold leading-tight">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      €{p.price.toFixed(2)} / {p.unit}
                    </p>
                  </div>
                  {qty === 0 ? (
                    <button
                      onClick={() => addToCart(p, line.qty)}
                      aria-label={`Reorder ${p.name}`}
                      className="tap-target flex h-14 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
                    >
                      <Repeat className="h-5 w-5" />
                      {line.qty}×
                    </button>
                  ) : (
                    <QuantitySelector
                      qty={qty}
                      onChange={(n) => updateQty(p.id, n)}
                      size="md"
                      label={p.name}
                    />
                  )}
                </article>
              );
            })}
          </section>
        )}
      </main>

      {/* Fixed cart CTA — pinned to the bottom of the viewport (or the phone
          screen on desktop, since DeviceFrame creates a containing block via
          translateZ). Stays put while the product list scrolls underneath. */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px] border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <button
          onClick={() => nav("/cart")}
          disabled={cartCount === 0}
          className="tap-target flex h-16 w-full items-center justify-between gap-3 rounded-2xl bg-primary px-5 text-base font-bold uppercase tracking-wider text-primary-foreground shadow-rugged active:translate-y-0.5 active:shadow-press disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" />
            Cart {cartCount > 0 && `· ${cartCount}`}
          </span>
          <span className="font-display text-xl normal-case tracking-normal">
            €{total.toFixed(2)}
          </span>
        </button>
      </div>

      <MisuseDialog open={!!misuse} term={misuse} onClose={() => setMisuse(null)} />

      {/* Voice disambiguation — multiple close matches.
          For multi-item commands the header shows "(n of N)" and pressing
          a candidate auto-advances to the next ambiguous item. */}
      <Sheet
        open={!!voiceAmbiguous}
        onOpenChange={(o) => {
          if (!o) skipAmbiguousItem();
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[80vh] overflow-y-auto"
          overlayClassName="bg-black/30"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-2xl">
              Welches Produkt?
              {voiceAmbiguous && voiceAmbiguous.total > 1 && (
                <span className="ml-2 text-base font-normal text-muted-foreground">
                  ({voiceAmbiguous.position} of {voiceAmbiguous.total})
                </span>
              )}
            </SheetTitle>
            <SheetDescription>
              {voiceAmbiguous && (
                <>
                  Mehrere Treffer für „{voiceAmbiguous.phrase}". Bitte Produkt
                  wählen, um{" "}
                  <span className="font-bold text-foreground">
                    {voiceAmbiguous.qty}×
                  </span>{" "}
                  in den Warenkorb zu legen.
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {(voiceAmbiguous?.candidates ?? []).map((c) => {
              const p = toProduct(c);
              return (
                <button
                  key={c.id}
                  onClick={() => pickVoiceCandidate(c)}
                  className="tap-target flex w-full items-center gap-3 rounded-xl bg-card p-3 text-left shadow-rugged ring-1 ring-border active:translate-y-0.5"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center">
                    <SubcategoryIcon
                      subcategory={p.subcategory}
                      category={p.category}
                      className="h-12 w-12"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-semibold leading-tight">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.sku} · {p.unit}
                    </p>
                    {p.price > 0 ? (
                      <p className="mt-0.5 font-display text-base">€{p.price.toFixed(2)}</p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">Preis auf Anfrage</p>
                    )}
                  </div>
                  <Plus className="h-5 w-5 text-primary" />
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default OrderSearch;
