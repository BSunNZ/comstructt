import { describe, it, expect } from "vitest";
import { parseVoiceOrderMulti } from "@/lib/voiceOrderMulti";

describe("parseVoiceOrderMulti — English", () => {
  it("Order 500 screws, 20 gloves, 10 WD-40", () => {
    const r = parseVoiceOrderMulti("Order 500 screws, 20 gloves, 10 WD-40");
    expect(r.isOrder).toBe(true);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ quantity: 500, productPhrase: "screws" });
    expect(r.items[1]).toMatchObject({ quantity: 20, productPhrase: "gloves" });
    expect(r.items[2]).toMatchObject({ quantity: 10, productPhrase: "WD-40" });
  });

  it("Add 50 drywall screws, 5 PVC pipes, 2 tape rolls", () => {
    const r = parseVoiceOrderMulti("Add 50 drywall screws, 5 PVC pipes, 2 tape rolls");
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ quantity: 50, productPhrase: "drywall screws" });
    expect(r.items[1]).toMatchObject({ quantity: 5, productPhrase: "PVC pipes" });
    expect(r.items[2]).toMatchObject({ quantity: 2, productPhrase: "tape rolls" });
  });

  it('Mixed conjunction "and" + comma', () => {
    const r = parseVoiceOrderMulti("Order 10 hammers and 5 nails, 2 saws");
    expect(r.items).toHaveLength(3);
    expect(r.items.map((i) => i.productPhrase)).toEqual(["hammers", "nails", "saws"]);
    expect(r.items.map((i) => i.quantity)).toEqual([10, 5, 2]);
  });

  it("10-item order scales", () => {
    const r = parseVoiceOrderMulti(
      "Order 500 screws, 20 gloves, 10 WD-40, 5 PVC pipes, 8 tapes, 3 hammers, 100 anchors, 6 drills, 2 ladders, 50 bolts",
    );
    expect(r.items).toHaveLength(10);
    expect(r.items[9]).toMatchObject({ quantity: 50, productPhrase: "bolts" });
  });

  it('Chained "and" with leading pronoun ("I need …")', () => {
    const r = parseVoiceOrderMulti(
      "I need 50 screws and 20 gloves and 10 hammers and 5 nails",
    );
    expect(r.items).toHaveLength(4);
    expect(r.items.map((i) => i.quantity)).toEqual([50, 20, 10, 5]);
  });

  it('Chained "und" with leading pronoun ("Ich brauche …")', () => {
    const r = parseVoiceOrderMulti(
      "Ich brauche 50 Schrauben und 20 Handschuhe und 10 Hammer und 5 Dübel",
    );
    expect(r.items).toHaveLength(4);
    expect(r.items.map((i) => i.quantity)).toEqual([50, 20, 10, 5]);
  });
});

describe("parseVoiceOrderMulti — German", () => {
  it("Bestell 500 Schrauben, 20 Handschuhe, 10 Spraydosen", () => {
    const r = parseVoiceOrderMulti("Bestell 500 Schrauben, 20 Handschuhe, 10 Spraydosen");
    expect(r.isOrder).toBe(true);
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ quantity: 500, productPhrase: "Schrauben" });
    expect(r.items[1]).toMatchObject({ quantity: 20, productPhrase: "Handschuhe" });
    expect(r.items[2]).toMatchObject({ quantity: 10, productPhrase: "Spraydosen" });
  });

  it('"und" conjunction', () => {
    const r = parseVoiceOrderMulti("Bestell 50 Schrauben und 20 Dübel");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ quantity: 50, productPhrase: "Schrauben" });
    expect(r.items[1]).toMatchObject({ quantity: 20, productPhrase: "Dübel" });
  });

  it("decimal size 3,5x35 stays inside its segment (no false split)", () => {
    const r = parseVoiceOrderMulti("Bestell 25 Schrauben 3,5x35, 10 Handschuhe");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ quantity: 25, productPhrase: "Schrauben 3,5x35" });
    expect(r.items[1]).toMatchObject({ quantity: 10, productPhrase: "Handschuhe" });
  });
});

describe("parseVoiceOrderMulti — single-item & non-orders", () => {
  it("Single-item input still produces one item", () => {
    const r = parseVoiceOrderMulti("Order 50 screws");
    expect(r.isOrder).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ quantity: 50, productPhrase: "screws" });
  });

  it("Plain search (no verb) is not an order", () => {
    const r = parseVoiceOrderMulti("screws, gloves");
    expect(r.isOrder).toBe(false);
    expect(r.items).toHaveLength(0);
  });

  it("Empty input", () => {
    const r = parseVoiceOrderMulti("");
    expect(r.isOrder).toBe(false);
    expect(r.items).toHaveLength(0);
  });
});
