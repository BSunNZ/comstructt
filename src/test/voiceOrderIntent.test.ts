import { describe, it, expect } from "vitest";
import { parseVoiceOrder } from "@/lib/voiceOrderIntent";

describe("parseVoiceOrder — English", () => {
  it("Order 50 screws 4x40", () => {
    const r = parseVoiceOrder("Order 50 screws 4x40");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(50);
    expect(r.productPhrase).toBe("screws 4x40");
  });

  it("Add 20 gloves size M", () => {
    const r = parseVoiceOrder("Add 20 gloves size M");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(20);
    expect(r.productPhrase).toBe("gloves size M");
  });

  it("Need 100 drywall screws", () => {
    const r = parseVoiceOrder("Need 100 drywall screws");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(100);
    expect(r.productPhrase).toBe("drywall screws");
  });

  it("Put 5 WD-40 in cart — strips trailing 'in cart' and keeps WD-40", () => {
    const r = parseVoiceOrder("Put 5 WD-40 in cart");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(5);
    expect(r.productPhrase).toBe("WD-40");
  });

  it("Order 10 PVC pipes", () => {
    const r = parseVoiceOrder("Order 10 PVC pipes");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(10);
    expect(r.productPhrase).toBe("PVC pipes");
  });

  it("number words: order three hammers → qty 3", () => {
    const r = parseVoiceOrder("order three hammers");
    expect(r.quantity).toBe(3);
    expect(r.productPhrase).toBe("hammers");
  });
});

describe("parseVoiceOrder — German", () => {
  it("Bestell 50 Schrauben", () => {
    const r = parseVoiceOrder("Bestell 50 Schrauben");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(50);
    expect(r.productPhrase).toBe("Schrauben");
  });

  it("Füge 10 Handschuhe hinzu — drops 'hinzu' tail", () => {
    const r = parseVoiceOrder("Füge 10 Handschuhe hinzu");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(10);
    expect(r.productPhrase).toBe("Handschuhe");
  });

  it("Ich brauche 20 Dübel", () => {
    // "ich" is not a verb → falls into "brauche" only after "ich".
    // Current parser only matches verbs at start, so "Ich brauche…" should
    // still be detected because we strip leading filler "ich" implicitly?
    // Actually we don't list "ich" — confirm behaviour: parser sees "ich" first
    // → not a verb → returns isOrder:false. That's wrong for "Ich brauche…".
    // We treat this as a known limitation and add an explicit pre-strip below.
    const r = parseVoiceOrder("brauche 20 Dübel");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(20);
    expect(r.productPhrase).toBe("Dübel");
  });

  it("Bestell 50 Schrauben 4x40 — keeps size token in phrase", () => {
    const r = parseVoiceOrder("Bestell 50 Schrauben 4x40");
    expect(r.quantity).toBe(50);
    expect(r.productPhrase).toBe("Schrauben 4x40");
  });

  it("Number word: bestell drei Hammer → qty 3", () => {
    const r = parseVoiceOrder("bestell drei Hammer");
    expect(r.quantity).toBe(3);
    expect(r.productPhrase).toBe("Hammer");
  });
});

describe("parseVoiceOrder — non-order utterances", () => {
  it("Plain search 'screws 4x40' is not an order", () => {
    const r = parseVoiceOrder("screws 4x40");
    expect(r.isOrder).toBe(false);
    expect(r.productPhrase).toBe("screws 4x40");
  });

  it("Empty input", () => {
    const r = parseVoiceOrder("");
    expect(r.isOrder).toBe(false);
    expect(r.quantity).toBe(null);
    expect(r.productPhrase).toBe("");
  });

  it("Just a verb with no product", () => {
    const r = parseVoiceOrder("order");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(null);
    expect(r.productPhrase).toBe("");
  });
});

describe("parseVoiceOrder — verb at end / mid (German on-site speech)", () => {
  it("Verlängerungskabel 10 Meter zwei Stück kaufen → qty 2, phrase keeps 10 Meter", () => {
    const r = parseVoiceOrder("Verlängerungskabel 10 Meter zwei Stück kaufen");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(2);
    expect(r.productPhrase).toBe("Verlängerungskabel 10 Meter");
  });

  it("2 Stück Verlängerungskabel kaufen → qty 2, phrase 'Verlängerungskabel'", () => {
    const r = parseVoiceOrder("2 Stück Verlängerungskabel kaufen");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(2);
    expect(r.productPhrase).toBe("Verlängerungskabel");
  });

  it("Schrauben 4x40 50 Stück bestellen → qty 50, keeps 4x40 spec", () => {
    const r = parseVoiceOrder("Schrauben 4x40 50 Stück bestellen");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(50);
    expect(r.productPhrase).toBe("Schrauben 4x40");
  });

  it("Ich brauche 20 Dübel — strips leading 'Ich'", () => {
    const r = parseVoiceOrder("Ich brauche 20 Dübel");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(20);
    expect(r.productPhrase).toBe("Dübel");
  });

  it("5 pcs WD-40 order → qty 5, phrase WD-40", () => {
    const r = parseVoiceOrder("5 pcs WD-40 order");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(5);
    expect(r.productPhrase).toBe("WD-40");
  });
});

describe("parseVoiceOrder — edge cases", () => {
  it("Size token like 4x40 is NOT taken as quantity", () => {
    const r = parseVoiceOrder("Order screws 4x40");
    expect(r.isOrder).toBe(true);
    expect(r.quantity).toBe(null); // no real quantity given
    expect(r.productPhrase).toBe("screws 4x40");
  });

  it("German size: 3,5x35 stays in phrase", () => {
    const r = parseVoiceOrder("Bestell 25 Schrauben 3,5x35");
    expect(r.quantity).toBe(25);
    expect(r.productPhrase).toBe("Schrauben 3,5x35");
  });

  it("M8 spec stays in phrase", () => {
    const r = parseVoiceOrder("Add 4 bolts M8");
    expect(r.quantity).toBe(4);
    expect(r.productPhrase).toBe("bolts M8");
  });

  it("12mm spec stays in phrase, even when 12 looks like a number", () => {
    const r = parseVoiceOrder("Order 6 pipes 12mm");
    expect(r.quantity).toBe(6);
    expect(r.productPhrase).toBe("pipes 12mm");
  });
});
