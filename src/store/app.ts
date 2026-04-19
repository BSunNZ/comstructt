import { create } from "zustand";
import { CartLine, PROJECTS, Product, TRADE_TO_TRADE, Trade } from "@/data/catalog";

export type OrderStatus = "Requested" | "Ordered" | "Delivered";
export type DeliveryOption = "Today" | "Tomorrow" | "Pickup";

export type Order = {
  id: string;
  createdAt: number;
  projectId: string;
  lines: CartLine[];
  delivery: DeliveryOption;
  status: OrderStatus;
};

type State = {
  projectId: string;
  cart: CartLine[];
  orders: Order[];
  setProject: (id: string) => void;
  setCart: (lines: CartLine[]) => void;
  addToCart: (p: Product, qty?: number) => void;
  updateQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  placeOrder: (delivery: DeliveryOption) => Order;
  activeTrade: () => Trade;
};

const seedOrder: Order = {
  id: "ORD-1042",
  createdAt: Date.now() - 1000 * 60 * 60 * 6,
  projectId: PROJECTS[0].id,
  lines: [],
  delivery: "Tomorrow",
  status: "Ordered",
};

export const useApp = create<State>((set, get) => ({
  projectId: PROJECTS[0].id,
  cart: [],
  orders: [seedOrder],
  setProject: (id) => set({ projectId: id }),
  setCart: (lines) => set({ cart: lines }),
  addToCart: (p, qty = 1) => {
    const cart = [...get().cart];
    const i = cart.findIndex((l) => l.product.id === p.id);
    if (i >= 0) cart[i] = { ...cart[i], qty: cart[i].qty + qty };
    else cart.push({ product: p, qty });
    set({ cart });
  },
  updateQty: (productId, qty) => {
    set({
      cart: get()
        .cart.map((l) => (l.product.id === productId ? { ...l, qty: Math.max(0, qty) } : l))
        .filter((l) => l.qty > 0),
    });
  },
  removeFromCart: (productId) => set({ cart: get().cart.filter((l) => l.product.id !== productId) }),
  clearCart: () => set({ cart: [] }),
  placeOrder: (delivery) => {
    const order: Order = {
      id: "ORD-" + Math.floor(1000 + Math.random() * 9000),
      createdAt: Date.now(),
      projectId: get().projectId,
      lines: get().cart,
      delivery,
      status: "Requested",
    };
    set({ orders: [order, ...get().orders], cart: [] });
    return order;
  },
  activeTrade: () => {
    const p = PROJECTS.find((pr) => pr.id === get().projectId) ?? PROJECTS[0];
    return TRADE_TO_TRADE[p.trade];
  },
}));
