import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "@/components/TopBar";
import {
  Search,
  ShoppingCart,
  ChevronRight,
  HardHat,
  Hammer,
  Zap,
  Wrench,
  Home as HomeIcon,
  ConstructionIcon,
  MapPin,
} from "lucide-react";
import { useApp } from "@/store/app";
import { PROJECTS, ProjectTrade } from "@/data/catalog";

const TRADE_META: Record<ProjectTrade, { Icon: typeof HardHat; tone: string }> = {
  Trockenbau: { Icon: HomeIcon, tone: "bg-[hsl(var(--primary)/0.12)] text-primary" },
  Rohbau: { Icon: ConstructionIcon, tone: "bg-[hsl(var(--accent)/0.18)] text-accent-foreground" },
  Elektro: { Icon: Zap, tone: "bg-[hsl(45_95%_55%/0.18)] text-[hsl(38_90%_35%)]" },
  "Sanitär": { Icon: Wrench, tone: "bg-[hsl(210_80%_55%/0.15)] text-[hsl(210_70%_35%)]" },
  Dach: { Icon: Hammer, tone: "bg-[hsl(15_75%_50%/0.15)] text-[hsl(15_70%_35%)]" },
  Allgemein: { Icon: HardHat, tone: "bg-secondary text-secondary-foreground" },
};

const Index = () => {
  const cartCount = useApp((s) => s.cart.reduce((a, l) => a + l.qty, 0));
  const projectId = useApp((s) => s.projectId);
  const setProject = useApp((s) => s.setProject);
  const nav = useNavigate();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return PROJECTS;
    return PROJECTS.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.code.toLowerCase().includes(term) ||
        p.trade.toLowerCase().includes(term),
    );
  }, [q]);

  const selectSite = (id: string) => {
    setProject(id);
    nav("/order/trade");
  };

  return (
    <div className="min-h-screen bg-background pb-6">
      <TopBar
        title="Start"
        right={
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <Link
              to="/cart"
              className="relative grid h-12 w-12 place-items-center rounded-lg active:bg-white/10"
              aria-label="Warenkorb"
            >
              <ShoppingCart className="h-6 w-6 text-secondary-foreground" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {cartCount}
                </span>
              )}
            </Link>
          </div>
        }
      />

      <main className="mx-auto max-w-md px-4 pt-5">
        <h1 className="font-display text-3xl font-bold leading-tight text-foreground">
          Deine aktuelle Baustelle
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wähle eine Baustelle aus, um direkt Material zu bestellen.
        </p>

        {/* Prominent search — glove-friendly */}
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-5 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Baustelle suchen..."
            aria-label="Baustelle suchen"
            className="h-16 w-full rounded-2xl border-2 border-border bg-card pl-16 pr-4 text-lg font-medium shadow-rugged outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>

        {/* Active sites */}
        <section className="mt-6 space-y-3" aria-label="Aktive Baustellen">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Aktive Baustellen
            </h2>
            <span className="text-xs text-muted-foreground">{filtered.length}</span>
          </div>

          {filtered.length === 0 && (
            <p className="rounded-xl bg-muted p-4 text-center text-muted-foreground">
              Keine Baustelle gefunden.
            </p>
          )}

          {filtered.map((p) => {
            const meta = TRADE_META[p.trade];
            const Icon = meta.Icon;
            const isActive = p.id === projectId;
            return (
              <button
                key={p.id}
                onClick={() => selectSite(p.id)}
                className={`tap-target group flex w-full items-center gap-4 rounded-2xl p-4 text-left shadow-rugged ring-1 transition active:translate-y-0.5 active:shadow-press ${
                  isActive
                    ? "bg-card ring-2 ring-primary"
                    : "bg-card ring-border"
                }`}
              >
                <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-xl ${meta.tone}`}>
                  <Icon className="h-8 w-8" />
                </span>
                <span className="flex-1 leading-tight">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {p.code}
                  </span>
                  <span className="mt-0.5 block font-display text-xl font-semibold text-foreground">
                    {p.name}
                  </span>
                  <span className="mt-1 inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-secondary-foreground">
                    {p.trade}
                  </span>
                </span>
                <ChevronRight className="h-6 w-6 text-muted-foreground" />
              </button>
            );
          })}
        </section>
      </main>
    </div>
  );
};

export default Index;
