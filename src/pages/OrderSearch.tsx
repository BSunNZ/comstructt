import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { Search, ShoppingCart, Plus, Minus, Repeat, MapPin, Sparkles, X, Loader2, ClipboardList, Mic, MicOff, Send } from "lucide-react";
import { useApp } from "@/store/app";
import { isBanned, PROJECTS, Product } from "@/data/catalog";
import { useRecentOrderedProducts } from "@/hooks/useRecentOrderedProducts";
import { MisuseDialog } from "@/components/MisuseDialog";
import { useSmartProductSearch, DbProduct } from "@/hooks/useSmartProductSearch";
import { useWhisperVoiceInput as useVoiceInput } from "@/hooks/useWhisperVoiceInput";
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
import { CategoryGrid } from "@/components/CategoryGrid";
import { NotificationBell } from "@/components/NotificationBell";

// Map a Supabase normalized_products row into the local Product shape used by the cart.
// Price is sourced from supplier_product_mapping. When a project context is
// active, project-specific overrides (project_prices jsonb) win over the
// supplier's contract_price — see `pickBestPrice`. 0 means "no price
// available" → UI renders "Preis auf Anfrage".
const toProduct = (r: DbProduct): Product => ({
  id: String(r.id),
  name: r.product_name ?? r.family_name ?? "Unbenanntes Produkt",
  sku: r.family_key ?? String(r.id),
  unit: r.unit ?? "Stk",
  price: typeof r.price === "number" && r.price > 0 ? r.price : 0,
  category: r.category ?? "Allgemein",
  subcategory: r.subcategory ?? null,
  priceSource: r.priceSource ?? undefined,
  listPrice: typeof r.listPrice === "number" && r.listPrice > 0 ? r.listPrice : null,
  supplier: r.supplierName ?? null,
});

const OrderSearch = () => {
  const nav = useNavigate();
  const cart = useApp((s) => s.cart);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const projectId = useApp((s) => s.projectId);
  const addToCart = useApp((s) => s.addToCart);
  const updateQty = useApp((s) => s.updateQty);
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0];

  // Recently ordered on THIS site — live 30-day history from Supabase.
  // React Query cache is optimistically updated after checkout and then
  // invalidated/refetched on createOrder success so the newest purchase
  // appears immediately without a page reload.
  const { items: recentOrdered, loading: recentLoading, clearLocal: clearRecent } =
    useRecentOrderedProducts(projectId, 3);

  const [q, setQ] = useState("");
  const [misuse, setMisuse] = useState<string | null>(null);
  // Only one product card's detail dropdown can be open at a time.
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  // Per-card draft quantity for the "+ ADD" → quantity selector → "ADD TO CART" flow.
  // While a product id is in this map, the card shows the quantity selector +
  // "ADD TO CART" button instead of the "+ ADD" button. The value is the draft
  // quantity that will be added to the cart on confirm. Cleared after add.
  const [draftQtys, setDraftQtys] = useState<Record<string, number>>({});
  // Per-card "ADDED!" confirmation flash. Holds product ids that were just
  // added to the cart; cleared 1s later. Drives a brief checkmark on the
  // ADD TO CART button without collapsing the selector or removing the
  // button — so users can keep tapping to add more units.
  const [justAdded, setJustAdded] = useState<Record<string, true>>({});
  const justAddedTimers = useRef<Record<string, number>>({});
  useEffect(() => {
    return () => {
      // Clear any pending flash timers on unmount.
      Object.values(justAddedTimers.current).forEach((t) => window.clearTimeout(t));
    };
  }, []);
  const flashJustAdded = useCallback((id: string) => {
    setJustAdded((prev) => ({ ...prev, [id]: true }));
    if (justAddedTimers.current[id]) {
      window.clearTimeout(justAddedTimers.current[id]);
    }
    justAddedTimers.current[id] = window.setTimeout(() => {
      setJustAdded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete justAddedTimers.current[id];
    }, 1000);
  }, []);

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

  // Reset all per-card draft quantities whenever the search query is cleared
  // (X button, manual delete, or voice cancel). This snaps every card back to
  // the "+ ADD" state so the user starts fresh on the next search. Items
  // already committed to the cart are untouched — only the transient UI
  // state on the cards is wiped.
  useEffect(() => {
    if (q.trim() === "") {
      setDraftQtys((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    }
  }, [q]);

  const onTypeChange = (val: string) => {
    setQ(val);
    const banned = isBanned(val);
    if (banned) setMisuse(banned);
  };

  const bannedTerm = isBanned(q.trim());
  const searchTerm = !bannedTerm ? q : "";
  const { results: dbResults, loading, error, configured } = useSmartProductSearch(searchTerm, 20, projectId);

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
        const result = await resolveVoiceProduct(item.phrase, projectId);

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
    prewarm: prewarmVoice,
  } = useVoiceInput({
    lang: "de",
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
            <NotificationBell />
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

      <main className="mx-auto max-w-md px-4 pt-5 [padding-bottom:calc(env(safe-area-inset-bottom)+7.5rem)]">
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
            <Search className="pointer-events-none absolute left-6 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground" />
            <input
              value={listening && interim ? interim : q}
              onChange={(e) => onTypeChange(e.target.value)}
              placeholder={listening ? "Höre zu…" : "z.B. Kauf mir schrauben"}
              aria-label="Search materials"
              className={`block h-32 w-full border-2 bg-card pl-20 pr-32 text-sm shadow-rugged outline-none placeholder:text-muted-foreground placeholder:transition-opacity focus:placeholder:opacity-0 focus:border-primary rounded-full opacity-100 font-normal text-left font-sans ${
                listening ? "border-primary" : "border-border"
              }`}
            />
            <div className="absolute right-6 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {q && !listening && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  className="grid h-14 w-14 place-items-center rounded-full text-muted-foreground active:bg-muted"
                >
                  <X className="h-7 w-7" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleVoice}
                onPointerDown={() => prewarmVoice?.()}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
                title={voiceSupported ? "Voice input" : "Voice input not supported"}
                className={`tap-target grid h-20 w-20 place-items-center rounded-full transition active:translate-y-0.5 ${
                  listening
                    ? "animate-pulse bg-primary text-primary-foreground shadow-press"
                    : "bg-secondary text-secondary-foreground active:bg-white/10"
                } ${!voiceSupported ? "opacity-50" : ""}`}
              >
                {listening ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
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
                          <div className="mt-1 flex flex-wrap items-baseline gap-2">
                            <p className="font-display text-xl text-foreground">
                              €{p.price.toFixed(2)}
                              <span className="ml-1 text-sm font-normal text-muted-foreground">
                                / {p.unit}
                              </span>
                            </p>
                            {p.priceSource === "project" && (
                              <span
                                className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/30"
                                title="Projekt-spezifischer Sonderpreis"
                              >
                                Projektpreis
                              </span>
                            )}
                            {p.priceSource === "project" &&
                              typeof p.listPrice === "number" &&
                              p.listPrice > p.price && (
                                <span
                                  className="text-sm text-muted-foreground line-through"
                                  title={`Standardpreis €${p.listPrice.toFixed(2)} — du sparst €${(p.listPrice - p.price).toFixed(2)} / ${p.unit}`}
                                >
                                  €{p.listPrice.toFixed(2)}
                                </span>
                              )}
                          </div>
                        ) : (
                          <p className="mt-1 font-display text-base text-muted-foreground">
                            Preis auf Anfrage
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Lieferant: {supplierByProduct.get(p.id) || (
                            <span className="italic text-muted-foreground/70">
                              nicht verfügbar
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {(() => {
                      // Card now has a single, stable layout once the user
                      // engages with it: ADD TO CART button stacked above a
                      // quantity selector. The button stays visible after
                      // every click — only the icon/label briefly flashes
                      // "ADDED!" — so users can keep tapping to add more
                      // units. We never collapse to a "view-only" state.
                      const draft = draftQtys[p.id];
                      const inDraft = draft !== undefined;

                      if (!inDraft && qty === 0) {
                        // Initial state: "+ ADD" immediately drops 1 unit
                        // into the cart AND opens the stepper so the user
                        // can fine-tune the quantity afterwards.
                        return (
                          <button
                            onClick={() => {
                              addToCart(p, 1);
                              flashJustAdded(p.id);
                              setDraftQtys((prev) => ({ ...prev, [p.id]: 1 }));
                              toast({
                                variant: "success",
                                title: "Added to cart",
                                description: `1× ${p.name}`,
                              });
                            }}
                            className="tap-target mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
                          >
                            <Plus className="h-5 w-5" /> Add
                          </button>
                        );
                      }

                      // Engaged state — once the user has added the
                      // product, the card collapses to ONLY the quantity
                      // stepper. Tapping +/− on the stepper writes
                      // directly to the cart so the user never has to
                      // move their finger to a separate "Add to cart"
                      // button. Confirmation lives in the green toast at
                      // the top of the screen instead.
                      const selectorQty = inDraft ? draft : qty;

                      return (
                        <div className="mt-3 flex flex-col gap-2">
                          <QuantitySelector
                            qty={selectorQty}
                            onChange={(n) => {
                              const next = Math.max(0, n);
                              setDraftQtys((prev) => ({ ...prev, [p.id]: next }));
                              // Mirror the change into the cart in real
                              // time so +/− behave like add/remove.
                              updateQty(p.id, next);
                              if (next > qty) {
                                flashJustAdded(p.id);
                                toast({
                                  variant: "success",
                                  title: "Added to cart",
                                  description: `${next}× ${p.name}`,
                                });
                              }
                            }}
                            size="lg"
                            label={p.name}
                          />
                          {qty > 0 && (
                            <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {qty}× im Warenkorb
                            </p>
                          )}
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

        {/* Last ordered on this site — top 8 distinct products from the last 30 days.
            Hidden while the user is actively searching; shows a gentle CTA when empty. */}
        {q.trim().length < 2 && (
          <section className="mt-6 space-y-3" aria-label="Recently ordered">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Recently ordered on this site
              </h2>
              {recentOrdered.length > 0 && (
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-xs font-semibold text-primary active:opacity-60"
                >
                  Clear all
                </button>
              )}
            </div>

            {recentLoading && recentOrdered.length === 0 ? (
              <div className="flex items-center gap-2 rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-rugged ring-1 ring-border">
                <Loader2 className="h-4 w-4 animate-spin" />
                Lade letzte Bestellungen…
              </div>
            ) : recentOrdered.length === 0 ? (
              <div className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border">
                <p className="text-sm font-semibold text-foreground">Start your first order</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sobald auf dieser Baustelle bestellt wurde, erscheinen die letzten Produkte hier.
                </p>
              </div>
            ) : (
              recentOrdered.map(({ product: p, lastQty }) => {
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
                        {p.price > 0 ? `€${p.price.toFixed(2)} / ${p.unit}` : `Preis auf Anfrage · ${p.unit}`}
                      </p>
                    </div>
                    {qty === 0 ? (
                      <button
                        onClick={() => addToCart(p, lastQty)}
                        aria-label={`Reorder ${p.name}`}
                        className="tap-target flex h-14 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
                      >
                        <Repeat className="h-5 w-5" />
                        {lastQty}×
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
              })
            )}
          </section>
        )}

        {/* Browse by category — 2×3 grid + "Sonstiges" CTA. Hidden while
            the user is actively searching so results stay the focus. */}
        {q.trim().length < 2 && (
          <div className="mt-6">
            <CategoryGrid />
          </div>
        )}
      </main>

      {/* Fixed cart CTA — pinned to the bottom of the viewport (or the phone
          screen on desktop, since DeviceFrame creates a containing block via
          translateZ). Stays put while the product list scrolls underneath. */}
      <div
        className="fixed inset-x-0 z-50 mx-auto w-full max-w-[430px] border-t border-border bg-background/95 px-4 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-[bottom,padding] duration-200"
        // When the fake iOS keyboard is open inside DeviceFrame it sets
        // --ios-kb-h on the screen container. Lift by that amount + 8px so
        // the teal button sits just above the keys with a small breathing
        // gap, and collapse the bottom safe-area padding (which is meant
        // for the home indicator, not the keyboard) so the bar doesn't
        // float far above the keyboard.
        style={{
          bottom: "var(--ios-kb-h, 0px)",
          paddingBottom:
            "calc((1 - var(--ios-kb-open, 0)) * max(env(safe-area-inset-bottom), 1.5rem) + var(--ios-kb-open, 0) * 10px)",
        }}
      >
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
          className="max-h-[80vh] overflow-y-auto bg-background"
          overlayClassName="bg-black/10"
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
