/**
 * TaskHelperFAB
 * ----------------------------------------------------------------------------
 * Self-contained Floating Action Button + modal for "What are you building?".
 *
 * REMOVAL: this component is fully independent. To remove it, delete this file
 * and the single `<TaskHelperFAB />` mount in `src/App.tsx` (or wherever it's
 * rendered). It does not modify any shared state besides calling the existing
 * `useApp().addToCart` action.
 *
 * MATCHING: ships with a small local kit catalog (6 trades). When wired up to
 * pgvector + an embeddings Edge Function, swap `findKitLocally()` for an
 * `await supabase.functions.invoke("match-kits", { body: { query } })` call.
 * The rest of the UI (m² parsing, scaling, add-to-cart) stays the same.
 */
import { useMemo, useState } from "react";
import { Wand2, Plus, Minus, ShoppingCart } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useApp } from "@/store/app";
import { PRODUCTS, type Product } from "@/data/catalog";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Local kit catalog (one per trade). `perM2` is the per-square-meter factor;
// `base` is a fixed quantity added regardless of area.
// ---------------------------------------------------------------------------
type KitItem = { productId: string; perM2?: number; base?: number };
type Kit = {
  id: string;
  name: string;
  trade: string;
  keywords: string[]; // simple keyword fallback for local matching
  items: KitItem[];
};

const KITS: Kit[] = [
  {
    id: "kit-drywall",
    name: "Drywall Wall Kit",
    trade: "Drywall",
    keywords: ["drywall", "trockenbau", "gypsum", "wall", "wand", "rigips", "gipskarton"],
    items: [
      { productId: "gyp-2", perM2: 0.34 }, // gypsum boards (1 sheet ≈ 3 m²)
      { productId: "gyp-1", perM2: 0.04 }, // screw boxes
      { productId: "gyp-4", perM2: 0.15 }, // joint compound
      { productId: "gyp-5", perM2: 0.05 }, // joint tape
      { productId: "gyp-7", perM2: 0.5 }, // CD profile bars
      { productId: "gyp-8", perM2: 2 }, // hangers
      { productId: "gyp-3", base: 1 }, // 1 knife per job
    ],
  },
  {
    id: "kit-concrete",
    name: "Concrete Pour Kit",
    trade: "Concrete",
    keywords: ["concrete", "rohbau", "beton", "slab", "pour", "estrich"],
    items: [
      { productId: "cn-1", perM2: 4 }, // bags of rapid set per m²
      { productId: "cn-2", perM2: 0.1 }, // tie wire rolls
    ],
  },
  {
    id: "kit-electrical",
    name: "Electrical Rough-in Kit",
    trade: "Electrical",
    keywords: ["electrical", "elektro", "wiring", "cable", "kabel", "strom"],
    items: [
      { productId: "el-1", perM2: 0.05 }, // cable rolls
      { productId: "el-2", perM2: 0.04 }, // connector packs
      { productId: "el-3", perM2: 0.1 }, // insulation tape
    ],
  },
  {
    id: "kit-plumbing",
    name: "Plumbing Rough-in Kit",
    trade: "Plumbing",
    keywords: ["plumbing", "sanitär", "pipe", "rohr", "wasser", "pex"],
    items: [
      { productId: "pl-1", perM2: 0.04 }, // PEX rolls
      { productId: "pl-2", perM2: 0.2 }, // PTFE tape
    ],
  },
  {
    id: "kit-roofing",
    name: "Roofing Membrane Kit",
    trade: "Roofing",
    keywords: ["roof", "dach", "membrane", "shingle", "ziegel"],
    items: [
      { productId: "rf-2", perM2: 0.015 }, // membrane rolls (1 roll ≈ 75 m²)
      { productId: "rf-1", perM2: 0.05 }, // nails kg
    ],
  },
  {
    id: "kit-general",
    name: "General Site Kit",
    trade: "General",
    keywords: ["general", "allgemein", "site", "winter", "ppe"],
    items: [
      { productId: "glv-1", base: 4 },
      { productId: "tape-1", base: 2 },
      { productId: "scr-w-out-1", base: 1 },
    ],
  },
];

// Parse "50 m2", "50m²", "50 sqm" → 50
function parseArea(input: string): number | null {
  const m = input.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|sqm|qm)/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findKitLocally(query: string): Kit | null {
  const q = query.toLowerCase();
  if (!q.trim()) return null;
  let best: { kit: Kit; score: number } | null = null;
  for (const kit of KITS) {
    let score = 0;
    for (const kw of kit.keywords) if (q.includes(kw)) score += kw.length;
    if (score > 0 && (!best || score > best.score)) best = { kit, score };
  }
  return best?.kit ?? null;
}

type ResolvedLine = { product: Product; qty: number };

function resolveKit(kit: Kit, area: number | null): ResolvedLine[] {
  const lines: ResolvedLine[] = [];
  for (const item of kit.items) {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    if (!product) continue;
    const fromArea = area && item.perM2 ? area * item.perM2 : 0;
    const qty = Math.max(1, Math.ceil(fromArea + (item.base ?? 0)));
    lines.push({ product, qty });
  }
  return lines;
}

export function TaskHelperFAB() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const addToCart = useApp((s) => s.addToCart);
  const { toast } = useToast();

  const area = useMemo(() => parseArea(query), [query]);
  const kit = useMemo(() => findKitLocally(query), [query]);
  const lines = useMemo(() => (kit ? resolveKit(kit, area) : []), [kit, area]);

  const [overrides, setOverrides] = useState<Record<string, number>>({});
  // Reset overrides when kit changes
  useMemo(() => setOverrides({}), [kit?.id, area]);

  const finalQty = (productId: string, base: number) =>
    overrides[productId] !== undefined ? overrides[productId] : base;

  const handleAddAll = () => {
    if (!kit || lines.length === 0) return;
    for (const l of lines) {
      const q = finalQty(l.product.id, l.qty);
      if (q > 0) addToCart(l.product, q);
    }
    toast({
      variant: "success",
      title: "Kit added to cart",
      description: `${kit.name}${area ? ` (${area} m²)` : ""} — ${lines.length} items`,
    });
    setOpen(false);
    setQuery("");
  };

  return (
    <>
      {/* FAB — anchored to the phone screen via the absolute parent (.phone-shell). */}
      <button
        type="button"
        aria-label="Open Task Helper"
        onClick={() => setOpen(true)}
        className="absolute bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
      >
        <Wand2 className="h-5 w-5" />
        <span className="text-sm font-semibold">Task Helper</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              Task Helper
            </DialogTitle>
            <DialogDescription>
              Describe what you're building and we'll suggest the right kit.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What are you building? (e.g., 50 m2 drywall)"
              className="text-base"
            />

            {query.trim() && !kit && (
              <p className="text-sm text-muted-foreground">
                No matching kit found. Try keywords like “drywall”, “concrete”, “electrical”, “plumbing”, or “roofing”.
              </p>
            )}

            {kit && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-sm font-semibold">{kit.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {area ? `Scaled for ${area} m²` : "Base quantities (no area detected)"}
                    </div>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {kit.trade}
                  </span>
                </div>

                <ul className="divide-y divide-border rounded-md border">
                  {lines.map((l) => {
                    const qty = finalQty(l.product.id, l.qty);
                    return (
                      <li key={l.product.id} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{l.product.name}</div>
                          <div className="text-xs text-muted-foreground">{l.product.unit}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() =>
                              setOverrides((o) => ({ ...o, [l.product.id]: Math.max(0, qty - 1) }))
                            }
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-7 text-center text-sm tabular-nums">{qty}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            onClick={() =>
                              setOverrides((o) => ({ ...o, [l.product.id]: qty + 1 }))
                            }
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <Button onClick={handleAddAll} className="w-full gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Add Kit to Cart
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
