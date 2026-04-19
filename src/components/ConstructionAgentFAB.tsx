/**
 * ConstructionAgentFAB
 * ----------------------------------------------------------------------------
 * Floating button + slide-up panel implementing the Simple Search Assistant:
 *   - User types a phrase ("Fugen machen", "50 m² Trockenbau", …).
 *   - We embed it server-side via the `construction-agent` edge function
 *     (action: "search") and render the matched kits as Suggestion Cards
 *     with an "Add to Project" button.
 *   - No conversational loops, no math questions. If the kit has per_m²
 *     items the user can optionally enter m² to scale quantities.
 *
 * Admin: a "Embeddings synchronisieren" button calls `construction-agent`
 * with action: "sync" to regenerate vectors after the catalog/keywords change.
 *
 * REMOVAL: this component is fully self-contained. Delete this file and the
 * `<ConstructionAgentFAB />` mount in `src/App.tsx` to remove the feature.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, Loader2, X, RefreshCw, Plus, Package, ArrowUp, HardHat } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useApp } from "@/store/app";
import { toast } from "@/hooks/use-toast";
import { recommendationToProduct, type AgentRecommendation } from "@/lib/constructionAgent";

type KitResult = {
  kitId: string;
  slug: string;
  name: string;
  trade: string;
  description: string;
  similarity: number;
  items: AgentRecommendation[];
  unmatched: string[];
};

type ChatMessage =
  | { id: string; role: "user"; text: string; ts: number }
  | { id: string; role: "assistant"; ts: number; busy?: boolean; error?: string | null; kits?: KitResult[]; query?: string };

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MATCH_THRESHOLD = 0.2;

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ConstructionAgentFAB() {
  const location = useLocation();
  const isHomePage = location.pathname === "/";

  const projectId = useApp((s) => s.projectId);
  const addToCart = useApp((s) => s.addToCart);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [areaInput, setAreaInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<KitResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSubmittedRef = useRef<string>("");

  // If we navigate away from home while the panel is open, close + unmount.
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
    if (!isSupabaseConfigured) {
      pushAssistant({ error: "Lovable Cloud ist nicht konfiguriert.", query: q });
      return;
    }
    const id = ++reqIdRef.current;

    const userMsgId = `u-${id}-${Date.now()}`;
    const assistantId = `a-${id}-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: areaM2 ? `${q} · ${areaM2} m²` : q, ts: Date.now() },
      { id: assistantId, role: "assistant", ts: Date.now(), busy: true, query: q },
    ]);
    setQuery("");
    setBusy(true);
    setError(null);

    try {
      let searchResponse = await supabase.functions.invoke("kit-assistant", {
        body: {
          action: "search",
          query: q,
          areaM2: areaM2 ?? undefined,
          projectId,
          matchCount: 3,
          matchThreshold: SEARCH_MATCH_THRESHOLD,
        },
      });

      if (searchResponse.error) {
        searchResponse = await supabase.functions.invoke("construction-agent", {
          body: {
            action: "search",
            query: q,
            areaM2: areaM2 ?? undefined,
            projectId,
            matchCount: 3,
            matchThreshold: SEARCH_MATCH_THRESHOLD,
          },
        });
      }
      if (id !== reqIdRef.current) return;

      let kits: KitResult[] = [];

      if (searchResponse.error) {
        const userContent = areaM2 && areaM2 > 0 ? `${q} (${areaM2} m²)` : q;
        const fallback = await supabase.functions.invoke("construction-agent", {
          body: { projectId, messages: [{ role: "user", content: userContent }] },
        });
        if (id !== reqIdRef.current) return;
        if (fallback.error) throw fallback.error;
        kits = parseKitResults(fallback.data, q);
      } else {
        const { data } = searchResponse;
        kits = parseKitResults(data, q);
        if (
          kits.length === 0 &&
          data &&
          typeof data === "object" &&
          "error" in (data as Record<string, unknown>)
        ) {
          const userContent = areaM2 && areaM2 > 0 ? `${q} (${areaM2} m²)` : q;
          const fallback = await supabase.functions.invoke("construction-agent", {
            body: { projectId, messages: [{ role: "user", content: userContent }] },
          });
          if (id !== reqIdRef.current) return;
          if (fallback.error) throw fallback.error;
          kits = parseKitResults(fallback.data, q);
        }
      }

      setResults(kits);
      setHasSearched(true);
      updateAssistant(assistantId, { busy: false, kits, query: q, error: null });
    } catch (e) {
      if (id !== reqIdRef.current) return;
      const message = e instanceof Error ? e.message : "Suche fehlgeschlagen";
      const mapped = mapAssistantError(message);
      setError(mapped);
      updateAssistant(assistantId, { busy: false, kits: [], query: q, error: mapped });
    } finally {
      if (id === reqIdRef.current) setBusy(false);
    }
  };

  const pushAssistant = (patch: Partial<Extract<ChatMessage, { role: "assistant" }>>) => {
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", ts: Date.now(), busy: false, ...patch },
    ]);
  };

  const updateAssistant = (
    id: string,
    patch: Partial<Extract<ChatMessage, { role: "assistant" }>>,
  ) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...patch } : m)),
    );
  };

  const addKit = (kit: KitResult) => {
    if (kit.items.length === 0) return;
    kit.items.forEach((rec) => addToCart(recommendationToProduct(rec), rec.quantity));
    toast({
      title: "Zum Projekt hinzugefügt",
      description: `${kit.items.length} Artikel aus „${kit.name}" übernommen.`,
    });
  };

  const syncEmbeddings = async () => {
    if (syncing || !isSupabaseConfigured) return;
    setSyncing(true);
    setDiagnostic(null);
    try {
      // Try the fresh function first; fall back to construction-agent.
      let res = await supabase.functions.invoke("kit-assistant", {
        body: { action: "sync" },
      });
      if (res.error) {
        console.warn("[ConstructionAgentFAB] kit-assistant sync unavailable, falling back", res.error);
        res = await supabase.functions.invoke("construction-agent", {
          body: { action: "sync" },
        });
      }
      const { data, error: fnError } = res;
      if (fnError) throw fnError;
      const updated =
        typeof data?.updated === "number"
          ? data.updated
          : typeof data?.synced === "number"
          ? data.synced
          : 0;
      const failedCount = Array.isArray(data?.failed)
        ? data.failed.length
        : typeof data?.failed === "number"
        ? data.failed
        : 0;

      // Diagnose: how many kits have embeddings now?
      const diag = await supabase.functions.invoke("kit-assistant", {
        body: { action: "diagnose" },
      });
      if (!diag.error && diag.data) {
        const total = Number(diag.data.total) || 0;
        const withEmb = Number(diag.data.withEmbedding) || 0;
        setDiagnostic(`${withEmb} von ${total} Kits haben Embeddings`);
      }

      toast({
        title: "Embeddings aktualisiert",
        description:
          failedCount > 0
            ? `${updated} synchronisiert, ${failedCount} Fehler.`
            : `${updated} Kits neu eingebettet.`,
      });
      // If the user already searched, refresh the results.
      if (query.trim().length >= 2) {
        await runSearch(query.trim(), parseArea(areaInput));
      }
    } catch (e) {
      console.error("[ConstructionAgentFAB] sync error", e);
      toast({
        title: "Sync fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!isHomePage) return null;

  const showEmpty = messages.length === 0;

  return (
    <>
      <button
        type="button"
        aria-label="Open Construction Assistant"
        onClick={() => setOpen(true)}
        className="absolute bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
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
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Online
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={syncEmbeddings}
                disabled={syncing}
                aria-label="Embeddings synchronisieren"
                title="Embeddings synchronisieren"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </button>
            </div>
          </header>

          {/* Messages — flex-grow, scrollable */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto bg-background px-3 py-3"
          >
            {diagnostic && (
              <div className="mx-auto mb-2 w-fit rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
                {diagnostic}
              </div>
            )}

            {showEmpty ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                  <HardHat className="h-6 w-6" />
                </span>
                <p className="text-sm font-medium text-muted-foreground">
                  Sag mir, was du auf der Baustelle brauchst.
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  z.B. Fugen machen, Kabel verlegen, Schutz für Winter
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
                            Suche passende Kits…
                          </span>
                        )}
                        {!m.busy && m.error && (
                          <span className="flex items-start gap-2 text-destructive">
                            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {m.error}
                          </span>
                        )}
                        {!m.busy && !m.error && (m.kits?.length ?? 0) === 0 && (
                          <span className="text-muted-foreground">
                            Keine Kits gefunden. Versuche andere Begriffe oder klicke Sync.
                          </span>
                        )}
                        {!m.busy && !m.error && (m.kits?.length ?? 0) > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              {m.kits!.length} passende{m.kits!.length === 1 ? "s" : ""} Kit
                              {m.kits!.length === 1 ? "" : "s"} gefunden:
                            </p>
                            {m.kits!.map((kit) => (
                              <SuggestionCard
                                key={kit.kitId}
                                kit={kit}
                                onAdd={() => addKit(kit)}
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

function SuggestionCard({ kit, onAdd }: { kit: KitResult; onAdd: () => void }) {
  const total = kit.items.reduce(
    (acc, it) => acc + (it.unitPrice ?? 0) * it.quantity,
    0,
  );
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">{kit.name}</p>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {kit.trade} · {Math.round(kit.similarity * 100)}% Treffer
          </p>
        </div>
        {total > 0 && (
          <span className="shrink-0 font-display text-sm">€{total.toFixed(2)}</span>
        )}
      </div>

      {kit.items.length === 0 ? (
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          Keine Produkte verfügbar.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {kit.items.map((it) => (
            <li
              key={it.productId}
              className="flex items-center gap-2 text-xs text-foreground"
            >
              <Package className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{it.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {it.quantity}× {it.unit}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={kit.items.length === 0}
        onClick={onAdd}
      >
        <Plus className="mr-1 h-4 w-4" /> Add to Project
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

function mapAssistantError(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("api connection error") ||
    m.includes("openai_api_key") ||
    m.includes("service role") ||
    m.includes("openai embedding request failed") ||
    m.includes("missing messages") ||
    m.includes("failed to fetch")
  ) {
    return "API Connection Error";
  }
  return "Suche fehlgeschlagen";
}

/**
 * Accepts both response shapes:
 *   1. { kits: [...] }                — new search action (when deployed).
 *   2. { reply, recommendations: [] } — current chat-action response.
 * For #2 we synthesize a single KitResult so the UI renders the same way.
 */
function parseKitResults(data: unknown, query: string): KitResult[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;

  const parseItems = (raw: unknown): AgentRecommendation[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item): AgentRecommendation | null => {
        if (!item || typeof item !== "object") return null;
        const it = item as Record<string, unknown>;
        const productId = typeof it.productId === "string" ? it.productId : null;
        const name = typeof it.name === "string" ? it.name : null;
        const unit = typeof it.unit === "string" ? it.unit : null;
        const quantity = Number(it.quantity);
        if (!productId || !name || !unit || !Number.isFinite(quantity) || quantity <= 0)
          return null;
        const unitPrice = Number(it.unitPrice);
        const listPrice = Number(it.listPrice);
        return {
          productId,
          name,
          sku: typeof it.sku === "string" ? it.sku : null,
          unit,
          quantity: Math.max(1, Math.ceil(quantity)),
          unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null,
          supplier: typeof it.supplier === "string" ? it.supplier : null,
          category: typeof it.category === "string" ? it.category : null,
          subcategory: typeof it.subcategory === "string" ? it.subcategory : null,
          priceSource:
            it.priceSource === "project" || it.priceSource === "contract"
              ? it.priceSource
              : null,
          listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : null,
        };
      })
      .filter(Boolean) as AgentRecommendation[];
  };

  // Shape #1 — { kits: [...] }
  if (Array.isArray(obj.kits)) {
    const out: KitResult[] = [];
    for (const k of obj.kits) {
      if (!k || typeof k !== "object") continue;
      const r = k as Record<string, unknown>;
      out.push({
        kitId: typeof r.kitId === "string" ? r.kitId : String(r.kitId ?? ""),
        slug: typeof r.slug === "string" ? r.slug : "",
        name: typeof r.name === "string" ? r.name : "Kit",
        trade: typeof r.trade === "string" ? r.trade : "",
        description: typeof r.description === "string" ? r.description : "",
        similarity: Number(r.similarity) || 0,
        items: parseItems(r.items),
        unmatched: Array.isArray(r.unmatched) ? r.unmatched.map(String) : [],
      });
    }
    return out;
  }

  // Shape #2 — { reply, recommendations: [] } from the chat action.
  if (Array.isArray(obj.recommendations)) {
    const items = parseItems(obj.recommendations);
    if (items.length === 0) return [];
    const reply = typeof obj.reply === "string" ? obj.reply : "";
    return [
      {
        kitId: "agent",
        slug: "agent",
        name: query.trim() ? `Vorschlag für „${query.trim()}"` : "Vorschlag",
        trade: "",
        description: reply,
        similarity: 1,
        items,
        unmatched: [],
      },
    ];
  }

  return [];
}
