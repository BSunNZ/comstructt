import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { useNotifications } from "@/store/notifications";

/**
 * Bell icon with unread badge. Drop into TopBar's `right` slot on any
 * page that should expose the inbox. Clicking opens /notifications.
 */
export const NotificationBell = () => {
  const unread = useNotifications((s) => s.items.filter((it) => !it.read_at).length);
  return (
    <Link
      to="/notifications"
      className="relative grid h-12 w-12 place-items-center rounded-lg active:bg-white/10"
      aria-label={`Benachrichtigungen${unread > 0 ? ` (${unread} ungelesen)` : ""}`}
    >
      <Bell className="h-6 w-6" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-[hsl(var(--destructive))] px-1 text-[10px] font-bold text-[hsl(var(--destructive-foreground))] ring-2 ring-secondary"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
};
