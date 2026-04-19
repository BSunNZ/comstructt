import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Notification rows live in `public.notifications` and are created by the
 * `tg_orders_notify_status_change` trigger when an order's status moves to
 * a user-facing state. See db/migrations/2026-04-19_order_notifications.sql.
 */
export type NotificationType = "approved" | "rejected" | "requires_changes";

export type DbNotification = {
  id: string;
  created_at: string;
  read_at: string | null;
  user_id: string | null;
  project_id: string | null;
  order_id: string | null;
  type: NotificationType | string;
  title: string;
  body: string;
};

/** Last 4 of a UUID, uppercased — matches the format the DB trigger uses. */
export const shortOrderId = (orderId: string | null | undefined): string => {
  if (!orderId) return "????";
  return orderId.replace(/-/g, "").slice(-4).toUpperCase();
};

export async function listNotifications(projectId: string | null): Promise<DbNotification[]> {
  if (!isSupabaseConfigured) return [];
  let q = supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) {
    console.warn("[notifications] list failed", error.message);
    return [];
  }
  return (data ?? []) as DbNotification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[notifications] mark read failed", error.message);
}

export async function markAllNotificationsRead(projectId: string | null): Promise<void> {
  if (!isSupabaseConfigured) return;
  let q = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (projectId) q = q.eq("project_id", projectId);
  const { error } = await q;
  if (error) console.warn("[notifications] mark all read failed", error.message);
}
