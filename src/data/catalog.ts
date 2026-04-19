export type Trade = "Drywall" | "Concrete" | "Electrical" | "Plumbing" | "Roofing" | "General";
export type JobSize = "Small" | "Medium" | "Large";

export type Product = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  price: number;
  image?: string;
  category: string;
  subcategory?: string | null;
  tier?: "Good" | "Better" | "Best";
  // Where `price` came from when this product was hydrated from
  // supplier_product_mapping. Carried through into the cart + order_items
  // so we have an audit trail for project-specific negotiated pricing.
  priceSource?: "project" | "contract";
  // Original (non-project) supplier list/contract price, only set when a
  // project-specific override actually beat a higher contract price.
  // Rendered as a strikethrough next to the Projektpreis badge so the
  // user sees the negotiated saving. Null/undefined → no strikethrough.
  listPrice?: number | null;
  // Supplier name resolved from suppliers.name via supplier_product_mapping
  // (the supplier whose price was picked by `pickBestPrice`). Carried into
  // the cart and persisted on order_items.supplier_name as a snapshot.
  // null/undefined → "Lieferant nicht verfügbar" in the UI.
  supplier?: string | null;
};

export type CartLine = {
  product: Product;
  qty: number;
};

export type ProjectTrade = "Trockenbau" | "Rohbau" | "Elektro" | "Sanitär" | "Dach" | "Allgemein";

export const TRADE_TO_TRADE: Record<ProjectTrade, Trade> = {
  Trockenbau: "Drywall",
  Rohbau: "Concrete",
  Elektro: "Electrical",
  "Sanitär": "Plumbing",
  Dach: "Roofing",
  Allgemein: "General",
};

// IDs are real UUIDs that match rows in public.projects (seeded via SQL).
export const PROJECTS: { id: string; name: string; code: string; trade: ProjectTrade }[] = [
  { id: "37bf7435-a07d-5e64-87d6-a9d34e035df9", name: "Main Tower Frankfurt", code: "MTF-2024-01", trade: "Trockenbau" },
  { id: "45ae3a15-68b3-5b19-add8-86353d44bce6", name: "Riverside Lofts Köln", code: "RVL-22-08", trade: "Rohbau" },
  { id: "a4ede43f-113e-5b97-ab39-f54b30794b34", name: "Nordhafen Depot Hamburg", code: "NHD-07-B", trade: "Elektro" },
  { id: "6565d41c-2eec-59b6-98fa-098da41141e2", name: "Schulzentrum München-Ost", code: "SZM-15-A", trade: "Sanitär" },
];

export const PRODUCTS: Product[] = [
  { id: "scr-w-out-1", name: "Wood Screws 5×60mm — Outdoor A2", sku: "SCR-W-560-A2", unit: "box / 200", price: 18.9, category: "Fasteners", tier: "Good" },
  { id: "scr-w-out-2", name: "Wood Screws 5×60mm — Stainless A4", sku: "SCR-W-560-A4", unit: "box / 200", price: 28.5, category: "Fasteners", tier: "Better" },
  { id: "scr-w-out-3", name: "TORX Pro Wood Screw 5×60mm — A4 Coated", sku: "SCR-W-560-PRO", unit: "box / 200", price: 39.0, category: "Fasteners", tier: "Best" },

  { id: "tape-1", name: "Window Sealing Tape 75mm — Standard", sku: "TPE-WIN-75-S", unit: "roll 25m", price: 22.0, category: "Sealants", tier: "Good" },
  { id: "tape-2", name: "Window Sealing Tape 75mm — Vapor Barrier", sku: "TPE-WIN-75-V", unit: "roll 25m", price: 34.5, category: "Sealants", tier: "Better" },
  { id: "tape-3", name: "Window Tape 75mm — Pro Triple Layer", sku: "TPE-WIN-75-P", unit: "roll 25m", price: 49.9, category: "Sealants", tier: "Best" },

  { id: "glv-1", name: "Winter Work Gloves — Thermal", sku: "GLV-WIN-S", unit: "pair", price: 9.5, category: "PPE", tier: "Good" },
  { id: "glv-2", name: "Winter Gloves — Waterproof Grip", sku: "GLV-WIN-W", unit: "pair", price: 16.0, category: "PPE", tier: "Better" },
  { id: "glv-3", name: "Winter Gloves — Pro Insulated Cut-5", sku: "GLV-WIN-P", unit: "pair", price: 26.5, category: "PPE", tier: "Best" },

  { id: "gyp-1", name: "Drywall Screws 3.5×35mm Phosphate", sku: "SCR-DW-35", unit: "box / 500", price: 12.4, category: "Fasteners" },
  { id: "gyp-2", name: "Gypsum Board 12.5mm 1200×2500", sku: "GYP-125-B", unit: "sheet", price: 8.9, category: "Drywall" },
  { id: "gyp-3", name: "Drywall Knife 250mm Stainless", sku: "TLK-DWK-250", unit: "pcs", price: 14.0, category: "Tools" },
  { id: "gyp-4", name: "Joint Compound 20kg", sku: "JNT-CMP-20", unit: "bucket", price: 24.5, category: "Drywall" },
  { id: "gyp-5", name: "Joint Tape Paper 50mm", sku: "JNT-TPE-50", unit: "roll 75m", price: 4.2, category: "Drywall" },
  { id: "gyp-6", name: "Sanding Mesh 220 Grit", sku: "SND-MSH-220", unit: "pack / 10", price: 7.8, category: "Drywall" },
  { id: "gyp-7", name: "CD Ceiling Profile 60×27", sku: "PRF-CD-60", unit: "bar 3m", price: 6.5, category: "Drywall" },
  { id: "gyp-8", name: "Direct Hanger ES60", sku: "HNG-ES60", unit: "pcs", price: 0.6, category: "Drywall" },

  { id: "el-1", name: "Cable NYM-J 3×1.5mm²", sku: "CAB-NYM-3-15", unit: "roll 100m", price: 78.0, category: "Electrical" },
  { id: "el-2", name: "Wago 221 Connector 3-way", sku: "WAG-221-3", unit: "pack / 50", price: 24.0, category: "Electrical" },
  { id: "el-3", name: "Insulation Tape Black 19mm", sku: "TPE-INS-19", unit: "roll", price: 1.9, category: "Electrical" },

  { id: "pl-1", name: "PEX Pipe 16mm", sku: "PEX-16", unit: "roll 50m", price: 56.0, category: "Plumbing" },
  { id: "pl-2", name: "PTFE Sealing Tape 12mm", sku: "PTFE-12", unit: "roll", price: 1.2, category: "Plumbing" },

  { id: "rf-1", name: "Roofing Nails 2.8×25mm Galv.", sku: "NL-RF-28", unit: "kg", price: 3.8, category: "Roofing" },
  { id: "rf-2", name: "Underlay Membrane 1.5×50m", sku: "MEM-RF-150", unit: "roll", price: 89.0, category: "Roofing" },

  { id: "cn-1", name: "Rapid Set Concrete 25kg", sku: "CNC-RAP-25", unit: "bag", price: 6.4, category: "Concrete" },
  { id: "cn-2", name: "Rebar Tie Wire 1.4mm", sku: "WR-TIE-14", unit: "roll", price: 8.2, category: "Concrete" },
];

export const TASKS_BY_TRADE: Record<Trade, string[]> = {
  Drywall: ["Fix gypsum board", "Joint finishing", "Ceiling install", "Metal stud framing"],
  Concrete: ["Pour repair patch", "Anchor & fix", "Formwork prep"],
  Electrical: ["Cable pull", "Socket install", "Junction wiring"],
  Plumbing: ["PEX install", "Drain seal", "Fixture mount"],
  Roofing: ["Underlay install", "Flashing fix", "Tile replacement"],
  General: ["Site cleanup", "Demolition", "Protection install"],
};

export const RECOMMENDED: Record<string, { productId: string; qty: Record<JobSize, number> }[]> = {
  "Fix gypsum board": [
    { productId: "gyp-2", qty: { Small: 6, Medium: 14, Large: 30 } },
    { productId: "gyp-1", qty: { Small: 1, Medium: 2, Large: 4 } },
    { productId: "gyp-3", qty: { Small: 1, Medium: 1, Large: 2 } },
  ],
  "Joint finishing": [
    { productId: "gyp-4", qty: { Small: 1, Medium: 2, Large: 4 } },
    { productId: "gyp-5", qty: { Small: 1, Medium: 2, Large: 3 } },
    { productId: "gyp-6", qty: { Small: 1, Medium: 2, Large: 4 } },
    { productId: "gyp-3", qty: { Small: 1, Medium: 1, Large: 2 } },
  ],
  "Ceiling install": [
    { productId: "gyp-7", qty: { Small: 8, Medium: 18, Large: 36 } },
    { productId: "gyp-8", qty: { Small: 30, Medium: 70, Large: 140 } },
    { productId: "gyp-1", qty: { Small: 1, Medium: 2, Large: 4 } },
  ],
};

export function recommendedFor(task: string, size: JobSize): CartLine[] {
  const list = RECOMMENDED[task];
  if (!list) {
    // Fallback: pick a couple of generic items
    return [
      { product: PRODUCTS.find((p) => p.id === "gyp-1")!, qty: size === "Small" ? 1 : size === "Medium" ? 2 : 4 },
      { product: PRODUCTS.find((p) => p.id === "tape-1")!, qty: 1 },
    ];
  }
  return list.map((l) => ({ product: PRODUCTS.find((p) => p.id === l.productId)!, qty: l.qty[size] }));
}

export const LAST_ORDER: CartLine[] = [
  { product: PRODUCTS.find((p) => p.id === "scr-w-out-2")!, qty: 2 },
  { product: PRODUCTS.find((p) => p.id === "tape-1")!, qty: 4 },
  { product: PRODUCTS.find((p) => p.id === "glv-2")!, qty: 6 },
];

export const FAVORITES: CartLine[] = [
  { product: PRODUCTS.find((p) => p.id === "gyp-4")!, qty: 1 },
  { product: PRODUCTS.find((p) => p.id === "el-3")!, qty: 5 },
  { product: PRODUCTS.find((p) => p.id === "scr-w-out-1")!, qty: 1 },
];

// Banned / out-of-scope keywords
export const BANNED_TERMS = [
  "concrete truck", "ready-mix truck", "window", "windows", "steel beam", "steel beams",
  "i-beam", "crane", "scaffolding tower", "excavator", "rebar cage", "precast",
];

export function isBanned(query: string): string | null {
  const q = query.toLowerCase();
  return BANNED_TERMS.find((t) => q.includes(t)) ?? null;
}

// Toy "AI" search: keyword → 3 tiered results, optionally trade-aware
export function aiSearch(query: string, trade?: Trade): Product[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Trade-specific overrides — searches like "schraube" or "screw" return trade-specific items first.
  if (trade === "Drywall" && /(schraub|screw)/.test(q)) {
    return [
      PRODUCTS.find((p) => p.id === "gyp-1")!,
      PRODUCTS.find((p) => p.id === "scr-w-out-1")!,
      PRODUCTS.find((p) => p.id === "scr-w-out-2")!,
    ];
  }
  if (trade === "Electrical" && /(kabel|cable|leitung)/.test(q)) {
    return [
      PRODUCTS.find((p) => p.id === "el-1")!,
      PRODUCTS.find((p) => p.id === "el-2")!,
      PRODUCTS.find((p) => p.id === "el-3")!,
    ];
  }

  const groups: { match: string[]; ids: [string, string, string] }[] = [
    { match: ["screw", "wood", "outside", "outdoor", "schraube"], ids: ["scr-w-out-1", "scr-w-out-2", "scr-w-out-3"] },
    { match: ["window", "seal", "tape", "fenster", "dicht"], ids: ["tape-1", "tape-2", "tape-3"] },
    { match: ["glove", "winter", "ppe", "handschuh"], ids: ["glv-1", "glv-2", "glv-3"] },
  ];
  for (const g of groups) {
    if (g.match.some((m) => q.includes(m))) {
      return g.ids.map((id) => PRODUCTS.find((p) => p.id === id)!).filter(Boolean);
    }
  }
  const matches = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  if (trade) {
    matches.sort((a, b) => {
      const aT = a.category.toLowerCase().includes(trade.toLowerCase()) ? -1 : 0;
      const bT = b.category.toLowerCase().includes(trade.toLowerCase()) ? -1 : 0;
      return aT - bT;
    });
  }
  return matches.slice(0, 3);
}
