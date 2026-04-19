import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import { QuantityRow } from "@/components/QuantityRow";
import { useApp } from "@/store/app";
import { Loader2, Send, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PROJECTS } from "@/data/catalog";
import { createOrder, getProjectMinApproval, isUuid } from "@/lib/orders";
import { cartTotal, decideInitialStatus } from "@/lib/orderTotals";

const Cart = () => {
  const { cart, updateQty, removeFromCart, clearCart, projectId } = useApp();
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [minApproval, setMinApproval] = useState<number>(0);

  // Fast workflow: an empty cart should never sit on /cart — bounce straight
  // back to the search page so the next add is one tap away. Skip the bounce
  // while we're submitting (clearCart fires before nav("/order/status")).
  useEffect(() => {
    if (cart.length === 0 && !submitting) {
      nav("/order/trade", { replace: true });
    }
  }, [cart.length, submitting, nav]);

  // Pull the project's approval threshold once when the active project changes.
  // Falls back to 0 (= always auto-approve) on any error — never blocks the UI.
  useEffect(() => {
    let alive = true;
    getProjectMinApproval(projectId)
      .then((v) => alive && setMinApproval(v))
      .catch(() => alive && setMinApproval(0));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Single source of truth for the order total — same util used by tests.
  const total = cartTotal(cart);
  const missingPrice = cart.filter((l) => !(l.product.price > 0)).length;
  const linkableCount = cart.filter((l) => isUuid(l.product.id)).length;
  const skippedCount = cart.length - linkableCount;

  // Predict the status the order will land in, so the user sees BEFORE tapping
  // Send whether it goes straight to "Bestellt" or needs Freigabe.
  const projectedStatus = decideInitialStatus(total, minApproval);
  const needsApproval = projectedStatus === "requested";

  const submit = async () => {
    if (cart.length === 0 || submitting) return;
    if (linkableCount === 0) {
      console.error("[cart] submit blocked — no linkable lines", {
        cartCount: cart.length,
        skippedCount,
      });
      toast({
        title: "Keine Produkte verknüpfbar",
        description:
          "Diese Artikel stammen aus dem Demo-Katalog und können nicht bestellt werden. Bitte aus dem Produktkatalog hinzufügen.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0];
    try {
      // Re-read the threshold at submit-time so we don't race a concurrent
      // change in the projects table between mount and tap.
      const liveThreshold = await getProjectMinApproval(project.id);
      const liveTotal = cartTotal(cart);
      const status = decideInitialStatus(liveTotal, liveThreshold);

      await createOrder({
        projectId: project.id,
        siteName: project.name,
        orderedBy: "Site Crew",
        notes: project.code ? `Project ${project.code}` : null,
        status,
        lines: cart,
      });
      clearCart();
      toast({
        title: status === "ordered" ? "Bestellung ausgelöst" : "Bestellung wartet auf Freigabe",
        description:
          status === "ordered"
            ? `€${liveTotal.toFixed(2)} unter Freigabegrenze — direkt bestellt.`
            : `€${liveTotal.toFixed(2)} ≥ €${liveThreshold.toFixed(2)} — Freigabe erforderlich.`,
      });
      nav("/order/status");
    } catch (e) {
      console.error("[cart] createOrder failed", e);
      const err = e as { message?: string; code?: string; details?: string; hint?: string };
      const code = err?.code ? ` [${err.code}]` : "";
      const msg = err?.message ?? (typeof e === "string" ? e : "Please try again.");
      const detail = err?.details || err?.hint;
      toast({
        title: `Failed to send order${code}`,
        description: detail ? `${msg} — ${detail}` : msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Empty cart returns null — the redirect effect above bounces back to /order/trade.
  if (cart.length === 0) return null;

  return (
    <div className="min-h-screen bg-background pb-44">
      <TopBar
        title="Your Cart"
        subtitle={`${cart.length} item${cart.length === 1 ? "" : "s"}`}
        back="/order/trade"
      />
      <main className="mx-auto max-w-md px-4 pt-5">
        {skippedCount > 0 && (
          <div className="mb-3 rounded-xl bg-warning/10 p-3 text-xs text-foreground ring-1 ring-warning/30">
            {skippedCount} item{skippedCount === 1 ? "" : "s"} from the demo catalog cannot be linked to the
            product database and will be sent without a product reference.
          </div>
        )}
        {missingPrice > 0 && (
          <div className="mb-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground ring-1 ring-border">
            {missingPrice} Artikel ohne hinterlegten Lieferantenpreis — werden als „Preis auf Anfrage" gesendet.
          </div>
        )}
        <div className="space-y-3">
          {cart.map((l) => (
            <QuantityRow
              key={l.product.id}
              line={l}
              onChange={(q) => updateQty(l.product.id, q)}
              onRemove={() => removeFromCart(l.product.id)}
            />
          ))}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[430px] border-t border-border bg-background/95 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur">
        {minApproval > 0 && (
          <div
            className={`mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ${
              needsApproval
                ? "bg-[hsl(45_95%_55%/0.18)] text-[hsl(38_90%_28%)] ring-[hsl(45_85%_75%)]"
                : "bg-[hsl(140_60%_45%/0.15)] text-[hsl(140_55%_22%)] ring-[hsl(140_45%_75%)]"
            }`}
          >
            {needsApproval ? (
              <ShieldAlert className="h-4 w-4 shrink-0" />
            ) : (
              <ShieldCheck className="h-4 w-4 shrink-0" />
            )}
            <span className="leading-tight">
              {needsApproval
                ? `Über Freigabegrenze (€${minApproval.toFixed(2)}) — Bestellung wartet auf Freigabe.`
                : `Unter Freigabegrenze (€${minApproval.toFixed(2)}) — wird direkt bestellt.`}
            </span>
          </div>
        )}
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="font-display text-3xl">€{total.toFixed(2)}</span>
        </div>
        <button
          onClick={submit}
          disabled={submitting || linkableCount === 0}
          className="tap-target flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-bold uppercase tracking-wider text-primary-foreground shadow-rugged active:translate-y-0.5 active:shadow-press disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Sending…
            </>
          ) : needsApproval ? (
            <>
              <Send className="h-5 w-5" /> Freigabe anfordern
            </>
          ) : (
            <>
              <Send className="h-5 w-5" /> Bestellung aufgeben
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Cart;
