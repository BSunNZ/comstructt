import { useEffect, useMemo, useState } from "react";
import { orderItemsTotal } from "@/lib/orderTotals";
import { TopBar } from "@/components/TopBar";
import { Clock, Truck, CheckCircle2, Package, Loader2, Eye, X, Ban } from "lucide-react";
import {
  DbOrder,
  DbOrderItem,
  DbOrderStatus,
  cancelOrder,
  isWithinCancelWindow,
  listOrdersForProject,
  markDelivered,
  normalizeStatus,
} from "@/lib/orders";
import { useApp } from "@/store/app";
import { PROJECTS } from "@/data/catalog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

type SectionKey = "Requested" | "Ordered" | "Delivered" | "Rejected";

const SECTION_META: Record<
  SectionKey,
  {
    label: string;
    description: string;
    Icon: typeof Clock;
    matches: DbOrderStatus[];
    headerBg: string;
    headerText: string;
    accentDot: string;
    cardBg: string;
    cardRing: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  Requested: {
    label: "Wartet auf Freigabe",
    description: "Über Freigabegrenze · benötigt Procurement-Bestätigung",
    Icon: Clock,
    matches: ["requested"],
    headerBg: "bg-[hsl(45_95%_55%/0.18)]",
    headerText: "text-[hsl(38_90%_28%)]",
    accentDot: "bg-[hsl(38_95%_50%)]",
    cardBg: "bg-[hsl(45_95%_96%)]",
    cardRing: "ring-[hsl(45_85%_75%)]",
    badgeBg: "bg-[hsl(45_95%_55%/0.25)]",
    badgeText: "text-[hsl(38_90%_28%)]",
  },
  Ordered: {
    label: "Bestellt",
    description: "Beim Lieferanten · in Anlieferung",
    Icon: Truck,
    matches: ["ordered"],
    headerBg: "bg-[hsl(210_80%_55%/0.18)]",
    headerText: "text-[hsl(210_70%_28%)]",
    accentDot: "bg-[hsl(210_80%_50%)]",
    cardBg: "bg-[hsl(210_85%_97%)]",
    cardRing: "ring-[hsl(210_70%_80%)]",
    badgeBg: "bg-[hsl(210_80%_55%/0.22)]",
    badgeText: "text-[hsl(210_70%_28%)]",
  },
  Delivered: {
    label: "Geliefert",
    description: "Auf der Baustelle eingetroffen",
    Icon: CheckCircle2,
    matches: ["delivered"],
    headerBg: "bg-[hsl(140_60%_45%/0.18)]",
    headerText: "text-[hsl(140_55%_22%)]",
    accentDot: "bg-[hsl(140_60%_40%)]",
    cardBg: "bg-[hsl(140_55%_96%)]",
    cardRing: "ring-[hsl(140_45%_75%)]",
    badgeBg: "bg-[hsl(140_60%_45%/0.22)]",
    badgeText: "text-[hsl(140_55%_22%)]",
  },
  Rejected: {
    label: "Abgelehnt",
    description: "Vom Procurement abgelehnt · keine Lieferung",
    Icon: Ban,
    matches: ["rejected"],
    headerBg: "bg-[hsl(0_85%_55%/0.18)]",
    headerText: "text-[hsl(0_75%_32%)]",
    accentDot: "bg-[hsl(0_85%_50%)]",
    cardBg: "bg-[hsl(0_85%_97%)]",
    cardRing: "ring-[hsl(0_75%_78%)]",
    badgeBg: "bg-[hsl(0_85%_55%/0.22)]",
    badgeText: "text-[hsl(0_75%_32%)]",
  },
};

const SECTION_ORDER: SectionKey[] = ["Requested", "Ordered", "Delivered", "Rejected"];

// Map any DB status (including legacy values) to its visual section so we
// can pick the right color-coded badge per card in the unified list.
const sectionForStatus = (status: string | null | undefined): SectionKey => {
  const norm = normalizeStatus(status);
  return (
    SECTION_ORDER.find((k) => SECTION_META[k].matches.includes(norm)) ?? "Requested"
  );
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const shortId = (id: string) => "ORD-" + id.slice(0, 8).toUpperCase();

const itemName = (it: DbOrderItem): string =>
  it.normalized_products?.product_name ??
  it.normalized_products?.family_name ??
  "Unbenanntes Produkt";

const itemCount = (o: DbOrder) =>
  (o.order_items ?? []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);

const OrderOverview = () => {
  const projectId = useApp((s) => s.projectId);
  const project = PROJECTS.find((p) => p.id === projectId) ?? PROJECTS[0];

  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DbOrder | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DbOrder | null>(null);
  

  const refresh = async (alive: () => boolean = () => true) => {
    try {
      const data = await listOrdersForProject(project.id);
      if (alive()) setOrders(data);
    } catch (e) {
      if (alive())
        setError(
          (e as { message?: string })?.message ??
            (typeof e === "string" ? e : "Failed to load orders."),
        );
    } finally {
      if (alive()) setLoading(false);
    }
  };

  useEffect(() => {
    let aliveFlag = true;
    setLoading(true);
    setError(null);
    refresh(() => aliveFlag);
    return () => {
      aliveFlag = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Self-approval is intentionally NOT supported: orders can only be approved
  // (status → 'ordered') or rejected by an external procurement authority.
  // The site-crew UI never writes those transitions.

  const handleDelivered = async (o: DbOrder) => {
    setUpdatingId(o.id);
    try {
      await markDelivered(o.id);
      toast({ title: "Marked delivered" });
      setSelected((s) => (s && s.id === o.id ? { ...s, status: "delivered" } : s));
      await refresh();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast({
        title: `Failed to update${err?.code ? ` [${err.code}]` : ""}`,
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCancel = async (o: DbOrder) => {
    setUpdatingId(o.id);
    try {
      await cancelOrder(o.id);
      toast({ title: "Order cancelled successfully" });
      setSelected((s) => (s && s.id === o.id ? null : s));
      setCancelTarget(null);
      await refresh();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast({
        title: `Failed to cancel${err?.code ? ` [${err.code}]` : ""}`,
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  // Single unified list. Sort by section priority (Requested first, then
  // Ordered, Delivered, Rejected) and within each section by newest first
  // — keeps the most actionable orders at the top now that the tab bar
  // is gone.
  const orderedList = useMemo(() => {
    const priority = (o: DbOrder) => SECTION_ORDER.indexOf(sectionForStatus(o.status));
    return [...orders].sort((a, b) => {
      const dp = priority(a) - priority(b);
      if (dp !== 0) return dp;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders]);

  return (
    <div className="min-h-screen bg-background pb-10">
      <TopBar
        title="Order Overview"
        subtitle={loading ? "Loading…" : `${project.name} · ${orders.length} total`}
        back="/order/trade"
      />

      <main className="mx-auto max-w-md px-4 pt-5 space-y-3">
        {loading && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-muted p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading orders…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}

        {!loading && !error && orderedList.length === 0 && (
          <div className="flex items-center gap-3 rounded-2xl bg-muted p-4">
            <Package className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-semibold text-muted-foreground">
              Noch keine Bestellungen
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          orderedList.map((o) => {
            // Per-card status meta keeps the color-coded badge visible at
            // a glance now that grouped section headers are gone.
            const meta = SECTION_META[sectionForStatus(o.status)];
            const items = o.order_items ?? [];
            const count = itemCount(o);

            return (
              <article
                key={o.id}
                className={`rounded-2xl p-3.5 shadow-rugged ring-1 ${meta.cardBg} ${meta.cardRing}`}
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base leading-tight text-foreground">
                      {shortId(o.id)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {o.site_name ?? project.name} · {formatDate(o.created_at)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.badgeBg} ${meta.badgeText}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.accentDot}`} />
                    {meta.label}
                  </span>
                </header>

                <ul className="mt-2.5 space-y-1.5">
                  {items.length === 0 ? (
                    <li className="rounded-lg bg-card/70 px-2.5 py-2 text-xs text-muted-foreground">
                      No items linked
                    </li>
                  ) : (
                    items.slice(0, 3).map((it) => (
                      <li
                        key={it.id}
                        className="flex items-center gap-2.5 rounded-lg bg-card/70 px-2.5 py-2"
                      >
                        <span className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md bg-card px-2 font-display text-sm font-bold text-foreground ring-1 ring-border tabular-nums">
                          {it.quantity.toLocaleString("de-DE")}×
                        </span>
                        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-tight text-foreground break-words">
                          {itemName(it)}
                        </p>
                      </li>
                    ))
                  )}
                  {items.length > 3 && (
                    <li className="px-2.5 text-[11px] font-semibold text-muted-foreground">
                      +{items.length - 3} more
                    </li>
                  )}
                </ul>

                <footer className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {count} item{count === 1 ? "" : "s"}
                  </span>
                  <div className="flex items-center gap-1">
                    {isWithinCancelWindow(o.created_at) &&
                      normalizeStatus(o.status) !== "delivered" &&
                      normalizeStatus(o.status) !== "rejected" && (
                        <button
                          onClick={() => setCancelTarget(o)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-destructive hover:bg-destructive/10"
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                      )}
                    <button
                      onClick={() => setSelected(o)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-foreground hover:bg-card"
                    >
                      <Eye className="h-3.5 w-3.5" /> Details
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
      </main>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">{shortId(selected.id)}</DialogTitle>
                <DialogDescription>
                  {selected.site_name ?? project.name} · {formatDate(selected.created_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-semibold uppercase tracking-wider">
                    {SECTION_META[
                      (SECTION_ORDER.find((k) =>
                        SECTION_META[k].matches.includes(normalizeStatus(selected.status)),
                      ) ?? "Requested") as SectionKey
                    ].label}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Gesamtsumme</span>
                  <span className="font-display text-lg">
                    €{orderItemsTotal(selected.order_items).toFixed(2)}
                  </span>
                </div>
                {selected.ordered_by && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Ordered by</span>
                    <span className="font-semibold">{selected.ordered_by}</span>
                  </div>
                )}
                {normalizeStatus(selected.status) !== "rejected" && selected.notes && (
                  <div className="text-sm">
                    <p className="text-muted-foreground">Notes</p>
                    <p className="font-medium">{selected.notes}</p>
                  </div>
                )}
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Items ({itemCount(selected)})
                  </p>
                  <ul className="space-y-1.5">
                    {(selected.order_items ?? []).length === 0 ? (
                      <li className="rounded-lg bg-muted px-2.5 py-2 text-sm text-muted-foreground">
                        No items linked to this order.
                      </li>
                    ) : (
                      (selected.order_items ?? []).map((it) => (
                        <li
                          key={it.id}
                          className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-2"
                        >
                          <span className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md bg-card px-2 font-display text-sm font-bold ring-1 ring-border tabular-nums">
                            {it.quantity.toLocaleString("de-DE")}×
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-semibold leading-tight">
                              {itemName(it)}
                            </p>
                            {it.normalized_products?.unit && (
                              <p className="text-[11px] text-muted-foreground">
                                {it.normalized_products.unit}
                                {it.normalized_products.category
                                  ? ` · ${it.normalized_products.category}`
                                  : ""}
                              </p>
                            )}
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {normalizeStatus(selected.status) === "requested" && (
                  <p className="rounded-xl bg-[hsl(45_95%_55%/0.18)] px-4 py-3 text-center text-xs font-bold uppercase tracking-wider text-[hsl(38_90%_28%)]">
                    Wartet auf externe Procurement-Freigabe
                  </p>
                )}
                {normalizeStatus(selected.status) === "rejected" && (
                  <div className="rounded-xl border-2 border-[hsl(0_75%_55%)] bg-[hsl(0_85%_97%)] p-4">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[hsl(0_75%_32%)]">
                      <Ban className="h-4 w-4" />
                      Grund der Ablehnung
                    </p>
                    <p className="mt-2 text-sm font-medium leading-snug text-[hsl(0_75%_25%)]">
                      {selected.rejection_reason?.trim()
                        ? selected.rejection_reason
                        : "Kein konkreter Grund angegeben."}
                    </p>
                  </div>
                )}
                {normalizeStatus(selected.status) === "ordered" && (
                  <button
                    onClick={() => handleDelivered(selected)}
                    disabled={updatingId === selected.id}
                    className="tap-target flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-bold uppercase tracking-wider text-accent-foreground shadow-rugged active:translate-y-0.5 disabled:opacity-60"
                  >
                    {updatingId === selected.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5" />
                    )}
                    Als geliefert markieren
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <>
                  Order <span className="font-semibold">{shortId(cancelTarget.id)}</span> will be
                  permanently removed. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingId === cancelTarget?.id}>
              Keep order
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (cancelTarget) handleCancel(cancelTarget);
              }}
              disabled={updatingId === cancelTarget?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {updatingId === cancelTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Yes, cancel order"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OrderOverview;
