import { useEffect, useMemo, useState } from "react";
import { orderItemsTotal } from "@/lib/orderTotals";
import { TopBar } from "@/components/TopBar";
import { Clock, Truck, CheckCircle2, Package, Loader2, Eye, ClipboardCheck, X } from "lucide-react";
import {
  DbOrder,
  DbOrderItem,
  DbOrderStatus,
  cancelOrder,
  confirmOrder,
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

type SectionKey = "Requested" | "Ordered" | "Delivered";

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
};

const SECTION_ORDER: SectionKey[] = ["Requested", "Ordered", "Delivered"];

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

  const handleConfirm = async (o: DbOrder) => {
    setUpdatingId(o.id);
    try {
      await confirmOrder(o.id);
      toast({ title: "Order confirmed", description: "Status updated to Ordered." });
      setSelected((s) => (s && s.id === o.id ? { ...s, status: "ordered" } : s));
      await refresh();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast({
        title: `Failed to confirm${err?.code ? ` [${err.code}]` : ""}`,
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

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

  const grouped = useMemo(() => {
    const out: Record<SectionKey, DbOrder[]> = { Requested: [], Ordered: [], Delivered: [] };
    for (const o of orders) {
      const norm = normalizeStatus(o.status);
      for (const k of SECTION_ORDER) {
        if (SECTION_META[k].matches.includes(norm)) {
          out[k].push(o);
          break;
        }
      }
    }
    return out;
  }, [orders]);

  return (
    <div className="min-h-screen bg-background pb-10">
      <TopBar
        title="Order Overview"
        subtitle={loading ? "Loading…" : `${project.name} · ${orders.length} total`}
        back="/order/trade"
      />

      <main className="mx-auto max-w-md px-4 pt-5 space-y-7">
        {loading && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-muted p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading orders…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}

        {!loading && !error && SECTION_ORDER.map((k) => {
          const meta = SECTION_META[k];
          const Icon = meta.Icon;
          const list = grouped[k];

          return (
            <section key={k} aria-label={`${meta.label} orders`}>
              <header className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${meta.headerBg}`}>
                <span className={`grid h-11 w-11 place-items-center rounded-xl bg-card shadow-press ${meta.headerText}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <div className="flex-1 leading-tight">
                  <h2 className={`font-display text-xl font-bold uppercase tracking-wide ${meta.headerText}`}>
                    {meta.label}
                  </h2>
                  <p className={`text-xs font-semibold ${meta.headerText} opacity-80`}>
                    {meta.description}
                  </p>
                </div>
                <span
                  className={`grid h-9 min-w-9 place-items-center rounded-full bg-card px-2 font-display text-base font-bold ${meta.headerText} shadow-press`}
                >
                  {list.length}
                </span>
              </header>

              <div className="mt-3 space-y-2.5">
                {list.length === 0 ? (
                  <div className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${meta.cardBg} ${meta.cardRing}`}>
                    <Package className={`h-6 w-6 ${meta.headerText} opacity-60`} />
                    <p className={`text-sm font-semibold ${meta.headerText} opacity-80`}>
                      No {meta.label.toLowerCase()} items
                    </p>
                  </div>
                ) : (
                  list.map((o) => {
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
                              normalizeStatus(o.status) !== "delivered" && (
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
                  })
                )}
              </div>
            </section>
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
                {selected.notes && (
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
                  <button
                    onClick={() => handleConfirm(selected)}
                    disabled={updatingId === selected.id}
                    className="tap-target flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold uppercase tracking-wider text-primary-foreground shadow-rugged active:translate-y-0.5 disabled:opacity-60"
                  >
                    {updatingId === selected.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ClipboardCheck className="h-5 w-5" />
                    )}
                    Freigeben &amp; Bestellen
                  </button>
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
    </div>
  );
};

export default OrderOverview;
