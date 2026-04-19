import { Plus } from "lucide-react";
import { useApp } from "@/store/app";
import { toast } from "@/hooks/use-toast";
import type { Product } from "@/data/catalog";

// Placeholder recommendations — wire to a real "frequently bought together"
// query once available. Prices are illustrative only.
const SAMPLE_RECOMMENDATIONS: Product[] = [
  { id: "rec-duebel", name: "Dübel SX 8", sku: "duebel-sx8", unit: "Stk", price: 0.06, category: "Befestigung", subcategory: "Befestigung" },
  { id: "rec-uschb", name: "Unterlegscheiben M8", sku: "u-scheibe-m8", unit: "Stk", price: 0.04, category: "Befestigung", subcategory: "Befestigung" },
  { id: "rec-tx20", name: "TX20 Bit", sku: "bit-tx20", unit: "Stk", price: 1.2, category: "Werkzeug", subcategory: "Werkzeug" },
  { id: "rec-bohrer", name: "Bohrer 6mm", sku: "bohrer-6", unit: "Stk", price: 2.4, category: "Werkzeug", subcategory: "Werkzeug" },
];

export const CartRecommendations = () => {
  const addToCart = useApp((s) => s.addToCart);

  return (
    <section aria-label="Oft zusammen bestellt">
      <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Oft zusammen bestellt
      </h2>
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-3 pb-1">
          {SAMPLE_RECOMMENDATIONS.map((p) => (
            <article
              key={p.id}
              className="flex w-40 shrink-0 flex-col gap-2 rounded-2xl bg-card p-3 shadow-rugged ring-1 ring-border"
            >
              <div className="grid h-16 w-full place-items-center rounded-lg bg-[hsl(var(--primary)/0.08)] text-2xl font-display text-primary">
                {p.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  €{p.price.toFixed(2)} / {p.unit}
                </p>
              </div>
              <button
                onClick={() => {
                  addToCart(p, 1);
                  toast({ title: "Item added", description: `1× ${p.name}` });
                }}
                className="tap-target mt-1 flex h-10 w-full items-center justify-center gap-1 rounded-lg bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
                aria-label={`Add ${p.name}`}
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
