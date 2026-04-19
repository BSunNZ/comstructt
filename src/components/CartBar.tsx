import { useNavigate } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { useApp } from "@/store/app";
import { cartTotal } from "@/lib/orderTotals";

/**
 * Sticky bottom cart bar — same UX as the home/search page so users can
 * jump to /cart from anywhere they're adding products (category browse,
 * subcategory browse, etc.).
 */
export const CartBar = () => {
  const nav = useNavigate();
  const cart = useApp((s) => s.cart);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const total = cartTotal(cart);

  return (
    <div
      className="fixed inset-x-0 z-50 mx-auto w-full max-w-[430px] border-t border-border bg-background/95 px-4 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
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
  );
};
