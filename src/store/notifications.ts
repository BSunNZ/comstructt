import { create } from "zustand";
import type { DbNotification } from "@/lib/notifications";

/**
 * Lightweight notifications store. The realtime subscription pushes new
 * rows in via `pushNew`; the bell badge reads `unreadCount`; the
 * /notifications page reads `items`. Persistence lives in Supabase —
 * this store is just the in-memory mirror for snappy UI.
 */
type State = {
  items: DbNotification[];
  setAll: (items: DbNotification[]) => void;
  pushNew: (n: DbNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  unreadCount: () => number;
};

export const useNotifications = create<State>((set, get) => ({
  items: [],
  setAll: (items) => set({ items }),
  pushNew: (n) =>
    set((s) => {
      // De-dupe by id so a refetch + realtime echo never doubles up.
      if (s.items.some((it) => it.id === n.id)) return s;
      return { items: [n, ...s.items] };
    }),
  markRead: (id) =>
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id && !it.read_at ? { ...it, read_at: new Date().toISOString() } : it,
      ),
    })),
  markAllRead: () =>
    set((s) => {
      const now = new Date().toISOString();
      return {
        items: s.items.map((it) => (it.read_at ? it : { ...it, read_at: now })),
      };
    }),
  unreadCount: () => get().items.filter((it) => !it.read_at).length,
}));
