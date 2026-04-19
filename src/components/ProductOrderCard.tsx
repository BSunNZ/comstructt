import { Plus } from "lucide-react";
import { useApp } from "@/store/app";
import { toast } from "@/hooks/use-toast";
import { SubcategoryIcon } from "@/components/SubcategoryIcon";
import { QuantitySelector } from "@/components/QuantitySelector";
import type { Product } from "@/data/catalog";

type Props = { product: Product };

/**
 * Reusable product row used on the category browse pages. Mirrors the
 * search-result card on /order/trade: shows name, supplier, price,
 * project-pricing badge, and a tap target that adds the item to the cart
 * and then turns into an inline quantity stepper.
 */
export const ProductOrderCard = ({ product: p }: Props) => {
  const cart = useApp((s) => s.cart);
  const addToCart = useApp((s) => s.addToCart);
  const updateQty = useApp((s) => s.updateQty);
  const qty = cart.find((l) => l.product.id === p.id)?.qty ?? 0;

  return (
    <article className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border">
      <div className="flex items-start gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center">
          <SubcategoryIcon
            subcategory={p.subcategory}
            category={p.category}
            className="h-12 w-12"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{p.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.sku} · {p.unit}
          </p>
          {p.price > 0 ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <p className="font-display text-lg text-foreground">
                €{p.price.toFixed(2)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/ {p.unit}</span>
              </p>
              {p.priceSource === "project" && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/30">
                  Projektpreis
                </span>
              )}
              {p.priceSource === "project" &&
                typeof p.listPrice === "number" &&
                p.listPrice > p.price && (
                  <span className="text-xs text-muted-foreground line-through">
                    €{p.listPrice.toFixed(2)}
                  </span>
                )}
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-muted-foreground">Preis auf Anfrage</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Lieferant:{" "}
            {p.supplier ? (
              p.supplier
            ) : (
              <span className="italic text-muted-foreground/70">nicht verfügbar</span>
            )}
          </p>
        </div>
      </div>

      {qty === 0 ? (
        <button
          onClick={() => {
            addToCart(p, 1);
            toast({ variant: "success", title: "Added to cart", description: `1× ${p.name}` });
          }}
          className="tap-target mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-press active:translate-y-0.5"
        >
          <Plus className="h-5 w-5" /> Add
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <QuantitySelector
            qty={qty}
            onChange={(n) => updateQty(p.id, Math.max(0, n))}
            size="lg"
            label={p.name}
          />
          <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {qty}× im Warenkorb
          </p>
        </div>
      )}
    </article>
  );
};