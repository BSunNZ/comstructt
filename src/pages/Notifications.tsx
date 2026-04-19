import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, XCircle, AlertTriangle, CheckCheck } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { useApp } from "@/store/app";
import { useNotifications } from "@/store/notifications";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationType,
} from "@/lib/notifications";

const ICONS: Record<string, typeof CheckCircle2> = {
  approved: CheckCircle2,
  rejected: XCircle,
  requires_changes: AlertTriangle,
};

const TONES: Record<string, string> = {
  approved: "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]",
  rejected: "bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]",
  requires_changes: "bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))]",
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const days = Math.round(h / 24);
  if (days < 7) return `vor ${days} Tg`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
};

const Notifications = () => {
  const projectId = useApp((s) => s.projectId);
  const items = useNotifications((s) => s.items);
  const setAll = useNotifications((s) => s.setAll);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const nav = useNavigate();

  // Refetch on mount so deep-links / refreshes always show the freshest list.
  useEffect(() => {
    let alive = true;
    (async () => {
      const fresh = await listNotifications(projectId);
      if (alive) setAll(fresh);
    })();
    return () => {
      alive = false;
    };
  }, [projectId, setAll]);

  const onItemClick = async (id: string, orderId: string | null) => {
    markRead(id);
    void markNotificationRead(id);
    if (orderId) nav(`/order/status?focus=${orderId}`);
    else nav("/order/status");
  };

  const onMarkAll = async () => {
    markAllRead();
    void markAllNotificationsRead(projectId);
  };

  const unread = items.filter((it) => !it.read_at).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        title="Benachrichtigungen"
        subtitle={unread > 0 ? `${unread} ungelesen` : "Alles gelesen"}
        back="/order/status"
      />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-5 pb-32">
        {items.length > 0 && unread > 0 && (
          <button
            type="button"
            onClick={onMarkAll}
            className="mb-3 flex items-center gap-2 rounded-full bg-secondary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-foreground active:translate-y-0.5"
          >
            <CheckCheck className="h-4 w-4" /> Alle gelesen
          </button>
        )}

        {items.length === 0 ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-muted text-muted-foreground">
              <Bell className="h-8 w-8" />
            </span>
            <p className="text-sm font-semibold text-foreground">Noch keine Benachrichtigungen</p>
            <p className="max-w-[260px] text-xs text-muted-foreground">
              Sobald deine Bestellungen genehmigt oder abgelehnt werden, siehst du sie hier.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((n) => {
              const Icon = ICONS[n.type as NotificationType] ?? Bell;
              const tone = TONES[n.type as NotificationType] ?? "bg-muted text-foreground";
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onItemClick(n.id, n.order_id)}
                    className={`flex w-full items-start gap-3 rounded-2xl bg-card p-3 text-left shadow-rugged ring-1 ring-border active:translate-y-0.5 ${
                      !n.read_at ? "ring-primary/40" : ""
                    }`}
                  >
                    <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone}`}>
                      <Icon className="h-5 w-5" strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-foreground">{n.title}</span>
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {fmt(n.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                    </span>
                    {!n.read_at && (
                      <span
                        aria-hidden
                        className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
};

export default Notifications;
