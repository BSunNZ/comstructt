import { useNavigate } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { QuantityRow } from "@/components/QuantityRow";
import { useApp } from "@/store/app";
import { LAST_ORDER, FAVORITES, CartLine } from "@/data/catalog";
import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type Mode = "reorder" | "favorites";

const ListPage = ({ mode }: { mode: Mode }) => {
  const nav = useNavigate();
  const setCart = useApp((s) => s.setCart);
  const seed = mode === "reorder" ? LAST_ORDER : FAVORITES;
  const [lines, setLines] = useState<CartLine[]>(seed);

  const update = (id: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, qty: Math.max(0, qty) } : l)).filter((l) => l.qty > 0));

  const total = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const title = mode === "reorder" ? "Reorder Last Items" : "My Favorites";
  const subtitle = mode === "reorder" ? "Last delivery · adjust & send" : "Crew's go-to consumables";

  const send = () => {
    setCart(lines);
    toast({ title: "Cart loaded", description: `${lines.length} items moved to cart.` });
    nav("/cart");
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <TopBar title={title} subtitle={subtitle} back="/" />
      <main className="mx-auto max-w-md space-y-3 px-4 pt-5">
        {lines.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-center text-muted-foreground">Nothing here yet.</p>
        ) : (
          lines.map((l) => (
            <QuantityRow
              key={l.product.id}
              line={l}
              onChange={(q) => update(l.product.id, q)}
              onRemove={() => update(l.product.id, 0)}
            />
          ))
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="font-display text-2xl">€{total.toFixed(2)}</span>
        </div>
        <button
          onClick={send}
          disabled={lines.length === 0}
          className="tap-target flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold uppercase tracking-wider text-primary-foreground shadow-rugged active:translate-y-0.5 active:shadow-press disabled:opacity-50"
        >
          <Send className="h-5 w-5" /> Move to cart
        </button>
      </div>
    </div>
  );
};

export default ListPage;
