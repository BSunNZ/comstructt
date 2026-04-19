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
  // JSONB column on supplier_product_mapping. Keys are project UUIDs,
  // values are negotiated unit prices in EUR.
  //   { "<project_uuid_1>": 3.25, "<project_uuid_2>": 4.10 }
  project_prices: Record<string, number | string | null> | null;
  suppliers?: { name: string | null } | null;
};

/** Where the unit price came from for the active context. */
export type PriceSource = "project" | "contract";

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
  // Where `price` came from. Null when no price could be resolved.
  priceSource: PriceSource | null;
  supplierName: string | null;
  // Original (non-project) list/contract price for the SAME supplier whose
  // project price won. Only set when a project-specific override is in
  // effect AND a contract price is also available — used to render a
  // strikethrough "previous price" next to the Projektpreis badge so the
  // user sees the negotiated saving. Null in every other case.
  listPrice: number | null;
};

export const PRODUCT_TABLE = "normalized_products";

// NB: project_prices is a JSONB column. Keep the trailing select tight so
// PostgREST returns the entire jsonb blob — we filter client-side by the
// active project_id.
export const PRODUCT_SELECT =
  "id, category, subcategory, product_name, size, unit, packaging, storage_location, source_name, family_name, family_key, variant_label, variant_attributes, consumption_type, typical_site, is_hazmat, hazardous, supplier_product_mapping(contract_price, project_prices, supplier_id, suppliers(name))";

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

/**
 * Resolve the best unit price for a supplier mapping list, given the
 * currently active project. Pricing rules:
 *
 *   1. If the active `projectId` has an entry in `project_prices` and the
 *      value parses to a positive number, that wins (priceSource: "project").
 *   2. Otherwise fall back to `contract_price` (priceSource: "contract").
 *   3. If multiple supplier mappings exist, pick the lowest resolved price.
 *
 * Defensive against malformed JSON values: strings that don't parse as
 * numbers, negatives, NaN, etc., are all ignored — never crash the cart.
 */
export const pickBestPrice = (
  rows: SupplierMappingRow[] | null | undefined,
  projectId: string | null | undefined,
): {
  price: number | null;
  priceSource: PriceSource | null;
  supplierName: string | null;
  listPrice: number | null;
} => {
  if (!rows || rows.length === 0)
    return { price: null, priceSource: null, supplierName: null, listPrice: null };
  let best:
    | {
        price: number;
        priceSource: PriceSource;
        supplierName: string | null;
        // Contract price for THIS supplier row, kept so we can surface it
        // as the "original" price when the project override wins.
        contractPrice: number | null;
      }
    | null = null;
  for (const r of rows) {
    let resolved: { price: number; source: PriceSource } | null = null;

    // 1) Project-specific override (jsonb keyed by project_id).
    if (projectId && r.project_prices && typeof r.project_prices === "object") {
      const raw = (r.project_prices as Record<string, unknown>)[projectId];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n > 0) {
        resolved = { price: n, source: "project" };
      }
    }

    // 2) Fallback to contract price.
    if (!resolved && typeof r.contract_price === "number" && r.contract_price > 0) {
      resolved = { price: r.contract_price, source: "contract" };
    }

    if (!resolved) continue;
    if (best === null || resolved.price < best.price) {
      best = {
        price: resolved.price,
        priceSource: resolved.source,
        supplierName: r.suppliers?.name ?? null,
        contractPrice:
          typeof r.contract_price === "number" && r.contract_price > 0
            ? r.contract_price
            : null,
      };
    }
  }
  if (!best) return { price: null, priceSource: null, supplierName: null, listPrice: null };

  // Only show a strikethrough "original price" when the project override
  // actually beat a higher contract price. If the contract price is equal
  // or lower (shouldn't happen, but guard anyway), suppress it so we never
  // render a misleading "saving".
  const listPrice =
    best.priceSource === "project" &&
    best.contractPrice !== null &&
    best.contractPrice > best.price
      ? best.contractPrice
      : null;

  return {
    price: best.price,
    priceSource: best.priceSource,
    supplierName: best.supplierName,
    listPrice,
  };
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

/**
 * Enrich a raw row with derived `price`, `priceSource`, `supplierName`.
 * The `projectId` argument selects project-specific overrides; pass `null`
 * (or omit) when the user is browsing without a project context — only
 * contract_price will be considered.
 */
export const enrichProduct = (
  row: unknown,
  projectId: string | null | undefined = null,
): DbProduct => {
  const r = row as Omit<DbProduct, "price" | "priceSource" | "supplierName" | "listPrice">;
  const { price, priceSource, supplierName, listPrice } = pickBestPrice(
    r.supplier_product_mapping,
    projectId,
  );
  return { ...r, price, priceSource, supplierName, listPrice } as DbProduct;
};
