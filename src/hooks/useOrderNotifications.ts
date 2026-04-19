import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useApp } from "@/store/app";
import { useNotifications } from "@/store/notifications";
import {
  listNotifications,
  type DbNotification,
  type NotificationType,
} from "@/lib/notifications";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { createElement } from "react";

const TOAST_ICON = {
  approved: CheckCircle2,
  rejected: XCircle,
  requires_changes: AlertTriangle,
} as const;

const TOAST_TONE = {
  approved: "text-[hsl(var(--success))]",
  rejected: "text-[hsl(var(--destructive))]",
  requires_changes: "text-[hsl(var(--warning))]",
} as const;

const iconFor = (type: string) => TOAST_ICON[type as NotificationType] ?? CheckCircle2;
const toneFor = (type: string) => TOAST_TONE[type as NotificationType] ?? TOAST_TONE.approved;

/**
 * Mounted ONCE in App.tsx. Subscribes to INSERTs on `public.notifications`
 * for the active project, hydrates the in-memory store on mount, and
 * shows a Sonner toast for each new notification while the user is
 * inside the app.
 *
 * Also serves as a safety net: even if realtime drops, `listNotifications`
 * runs on every projectId change so the bell badge stays accurate.
 */
export function useOrderNotifications() {
  const projectId = useApp((s) => s.projectId);
  const setAll = useNotifications((s) => s.setAll);
  const pushNew = useNotifications((s) => s.pushNew);
  const nav = useNavigate();

  // Track which notification ids we've already toasted so a refetch never
  // re-fires a toast for an old item.
  const toastedRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !projectId) return;

    let cancelled = false;
    (async () => {
      const items = await listNotifications(projectId);
      if (cancelled) return;
      setAll(items);
      // Mark every existing item as already-toasted so we don't fire a
      // toast burst for historical rows on first mount.
      items.forEach((it) => toastedRef.current.add(it.id));
      hydratedRef.current = true;
    })();

    // Unique channel name per mount — supabase-js caches channels by name
    // and reusing one after `.subscribe()` throws "cannot add postgres_changes
    // callbacks ... after subscribe()" (happens with StrictMode/HMR remounts).
    const channel = supabase
      .channel(`notifications:project:${projectId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes" as never,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `project_id=eq.${projectId}`,
        },
        (payload: { new: DbNotification }) => {
          const n = payload.new;
          pushNew(n);
          if (toastedRef.current.has(n.id)) return;
          toastedRef.current.add(n.id);
          showOrderToast(n, () => {
            if (n.order_id) nav(`/order/status?focus=${n.order_id}`);
            else nav("/notifications");
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [projectId, setAll, pushNew, nav]);
}

/** Render a polished, iOS-feel toast for a notification. */
function showOrderToast(n: DbNotification, onClick: () => void) {
  const Icon = iconFor(n.type);
  const tone = toneFor(n.type);
  toast.custom(
    (id) =>
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            toast.dismiss(id);
            onClick();
          },
          className:
            "flex w-full items-start gap-3 rounded-2xl bg-card/95 px-4 py-3 text-left shadow-rugged ring-1 ring-border backdrop-blur-md active:scale-[0.99] transition-transform",
          "aria-label": `${n.title}: ${n.body}`,
        },
        createElement(
          "span",
          {
            className: `mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background ${tone}`,
          },
          createElement(Icon, { className: "h-5 w-5", strokeWidth: 2.5 }),
        ),
        createElement(
          "span",
          { className: "min-w-0 flex-1" },
          createElement(
            "span",
            { className: "block text-sm font-bold text-foreground" },
            n.title,
          ),
          createElement(
            "span",
            { className: "mt-0.5 block text-xs text-muted-foreground line-clamp-2" },
            n.body,
          ),
        ),
      ),
    {
      duration: 5000,
      position: "top-center",
    },
  );
}
