/**
 * Shared search internals used by both the live `useSmartProductSearch`
 * hook (interactive results) and the one-shot voice-order resolver
 * (single best match for "Order 50 screws").
 *
 * Keeping tokenization + scoring + price-picking in one module guarantees
 * the manual search and the voice shortcut behave identically — what you
 * see when you type is what voice will pick.
 */

export type SupplierMappingRow = {
  supplier_id: string | null;
  contract_price: number | null;
  project_price: number | null;
  suppliers?: { name: string | null } | null;
};

export type DbProduct = {
  id: string;
  category: string | null;
  subcategory: string | null;
  product_name: string | null;
  size: string | null;
  unit: string | null;
  packaging: string | null;
  storage_location: string | null;
  source_name: string | null;
  family_name: string | null;
  family_key: string | null;
  variant_label: string | null;
  variant_attributes: unknown | null;
  consumption_type: string | null;
  typical_site: string | null;
  is_hazmat: boolean | null;
  hazardous: boolean | null;
  supplier_product_mapping?: SupplierMappingRow[] | null;
  // Derived client-side from supplier_product_mapping (lowest active price).
  price: number | null;
  supplierName: string | null;
};

export const PRODUCT_TABLE = "normalized_products";

export const PRODUCT_SELECT =
  "id, category, subcategory, product_name, size, unit, packaging, storage_location, source_name, family_name, family_key, variant_label, variant_attributes, consumption_type, typical_site, is_hazmat, hazardous, supplier_product_mapping(contract_price, project_price, supplier_id, suppliers(name))";

export const SEARCH_COLUMNS = [
  "product_name",
  "family_name",
  "family_key",
  "category",
  "subcategory",
  "variant_label",
  "size",
  "source_name",
  "storage_location",
] as const;

export const COLUMN_WEIGHT: Record<string, number> = {
  product_name: 100,
  family_name: 90,
  family_key: 85,
  category: 50,
  subcategory: 50,
  variant_label: 40,
  size: 35,
  source_name: 25,
  storage_location: 10,
};

export const stripDiacritics = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");

const SYNONYMS: Record<string, string[]> = {
  schraube: ["schraube", "schrauben", "screw", "screws"],
  duebel: ["duebel", "dübel", "dubel", "anchor", "anchors", "plug", "plugs"],
  handschuh: ["handschuh", "handschuhe", "glove", "gloves"],
  rohr: ["rohr", "rohre", "pipe", "pipes"],
  kabel: ["kabel", "leitung", "leitungen", "draht", "draehte", "cable", "cables", "wire", "wires"],
  hammer: ["hammer", "hammers"],
  mutter: ["mutter", "muttern", "nut", "nuts"],
  scheibe: ["scheibe", "scheiben", "washer", "washers"],
  nagel: ["nagel", "naegel", "nägel", "nail", "nails"],
  band: ["band", "baender", "bänder", "tape", "tapes"],
  brett: ["brett", "bretter", "board", "boards"],
  platte: ["platte", "platten", "panel", "panels", "sheet", "sheets"],
  gross: ["gross", "grosse", "grosser", "grosses", "large", "big"],
  klein: ["klein", "kleine", "kleiner", "kleines", "small", "little"],
  lang: ["lang", "lange", "langer", "langes", "long"],
  kurz: ["kurz", "kurze", "kurzer", "kurzes", "short"],
};

export const tokenize = (raw: string): string[] => {
  const cleaned = stripDiacritics(raw.toLowerCase()).replace(/[^a-z0-9 ]+/g, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  const expanded = new Set<string>();
  for (const t of tokens) {
    expanded.add(t);
    for (const group of Object.values(SYNONYMS)) {
      const hit = group.includes(t) || group.some((g) => g.startsWith(t) || t.startsWith(g));
      if (hit) group.forEach((g) => expanded.add(g));
    }
  }
  return Array.from(expanded);
};

const escapeLike = (s: string) => s.replace(/[%_,()]/g, (m) => `\\${m}`);

export const buildOrFilter = (tokens: string[]): string => {
  const parts: string[] = [];
  for (const col of SEARCH_COLUMNS) {
    for (const t of tokens) {
      parts.push(`${col}.ilike.%${escapeLike(t)}%`);
    }
  }
  return parts.join(",");
};

export const pickBestPrice = (
  rows: SupplierMappingRow[] | null | undefined,
): { price: number | null; supplierName: string | null } => {
  if (!rows || rows.length === 0) return { price: null, supplierName: null };
  let best: { price: number; supplierName: string | null } | null = null;
  for (const r of rows) {
    const p =
      typeof r.project_price === "number" && r.project_price > 0
        ? r.project_price
        : typeof r.contract_price === "number" && r.contract_price > 0
          ? r.contract_price
          : null;
    if (p === null) continue;
    if (best === null || p < best.price) {
      best = { price: p, supplierName: r.suppliers?.name ?? null };
    }
  }
  return best ? best : { price: null, supplierName: null };
};

export const scoreProduct = (p: DbProduct, tokens: string[]): number => {
  let score = 0;
  for (const col of SEARCH_COLUMNS) {
    const raw = (p[col as keyof DbProduct] as string | null | undefined) ?? "";
    if (!raw) continue;
    const hay = stripDiacritics(String(raw).toLowerCase());
    for (const t of tokens) {
      if (!hay.includes(t)) continue;
      const w = COLUMN_WEIGHT[col] ?? 10;
      score += w;
      if (new RegExp(`(^|\\W)${t}(\\W|$)`).test(hay)) score += w * 0.4;
      if (hay.startsWith(t)) score += w * 0.2;
    }
  }
  return score;
};

export const diversifyByFamily = (
  ranked: { p: DbProduct; score: number }[],
  limit: number,
): DbProduct[] => {
  const seenFamily = new Set<string>();
  const seenName = new Set<string>();
  const primary: DbProduct[] = [];
  const overflow: DbProduct[] = [];

  for (const { p } of ranked) {
    const nameKey = (p.product_name ?? "").toLowerCase().trim();
    if (nameKey && seenName.has(nameKey)) continue;
    seenName.add(nameKey);

    const fk = (p.family_key ?? p.family_name ?? "").toLowerCase().trim();
    if (fk && !seenFamily.has(fk)) {
      seenFamily.add(fk);
      primary.push(p);
    } else {
      overflow.push(p);
    }
  }
  return [...primary, ...overflow].slice(0, limit);
};

/** Enrich a raw row with derived `price` + `supplierName`. */
export const enrichProduct = (row: unknown): DbProduct => {
  const r = row as Omit<DbProduct, "price" | "supplierName">;
  const { price, supplierName } = pickBestPrice(r.supplier_product_mapping);
  return { ...r, price, supplierName } as DbProduct;
};
