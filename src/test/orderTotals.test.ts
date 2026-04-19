import { describe, it, expect } from "vitest";
import { cartTotal, orderItemsTotal, decideInitialStatus } from "@/lib/orderTotals";
import type { CartLine } from "@/data/catalog";
import type { DbOrderItem } from "@/lib/orders";

const line = (price: number, qty: number, id = "p1"): CartLine => ({
  product: {
    id,
    name: "X",
    sku: "X",
    unit: "pcs",
    price,
    category: "Test",
  },
  qty,
});

const item = (unit_price: number | null, quantity: number, id = "i1"): DbOrderItem => ({
  id,
  order_id: "o1",
  product_id: null,
  product_name: null,
  unit: null,
  supplier_name: null,
  unit_price,
  quantity,
  line_total: unit_price !== null ? unit_price * quantity : null,
  created_at: new Date().toISOString(),
});

describe("cartTotal", () => {
  it("multiplies price × qty across lines", () => {
    expect(cartTotal([line(10, 2), line(5.5, 4)])).toBeCloseTo(42);
  });

  it("ignores lines with price 0 (Preis auf Anfrage)", () => {
    expect(cartTotal([line(0, 99), line(20, 3)])).toBe(60);
  });

  it("treats negative or NaN qty as 0", () => {
    expect(cartTotal([line(10, -5), line(10, NaN as unknown as number)])).toBe(0);
  });

  it("returns 0 for empty cart", () => {
    expect(cartTotal([])).toBe(0);
  });
});

describe("orderItemsTotal", () => {
  it("sums unit_price × quantity, treating null as 0", () => {
    expect(orderItemsTotal([item(10, 3), item(null, 99), item(2.5, 4)])).toBeCloseTo(40);
  });

  it("returns 0 for null/undefined", () => {
    expect(orderItemsTotal(null)).toBe(0);
    expect(orderItemsTotal(undefined)).toBe(0);
  });
});

describe("decideInitialStatus", () => {
  it("auto-approves (ordered) when threshold is 0 / null / negative", () => {
    expect(decideInitialStatus(9999, 0)).toBe("ordered");
    expect(decideInitialStatus(9999, null)).toBe("ordered");
    expect(decideInitialStatus(9999, undefined)).toBe("ordered");
    expect(decideInitialStatus(9999, -50)).toBe("ordered");
    expect(decideInitialStatus(9999, NaN)).toBe("ordered");
  });

  it("returns 'ordered' when total is strictly below threshold", () => {
    expect(decideInitialStatus(99.99, 100)).toBe("ordered");
    expect(decideInitialStatus(0, 100)).toBe("ordered");
  });

  it("returns 'requested' when total meets or exceeds threshold", () => {
    expect(decideInitialStatus(100, 100)).toBe("requested");
    expect(decideInitialStatus(250, 100)).toBe("requested");
  });

  it("integration: cart total drives the threshold decision", () => {
    const small = [line(10, 5)]; // 50
    const big = [line(10, 50)]; // 500
    expect(decideInitialStatus(cartTotal(small), 100)).toBe("ordered");
    expect(decideInitialStatus(cartTotal(big), 100)).toBe("requested");
  });
});
