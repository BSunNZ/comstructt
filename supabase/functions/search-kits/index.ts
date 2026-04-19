/**
 * search-kits
 * ----------------------------------------------------------------------------
 * Simple, non-conversational kit search.
 *
 * Request:  POST { query: string, projectId?: string, areaM2?: number, matchCount?: number }
 * Response: { kits: [{ kitId, slug, name, trade, description, similarity, items: [...recommendation] }] }
 *
 * Each item in `items` is a fully resolved product row pulled from
 * normalized_products + supplier_product_mapping with project-aware pricing,
 * ready to drop into the cart. Quantities are scaled by `areaM2` when the
 * kit_item has a per_m2 factor.
 *
 * Deploy: supabase functions deploy search-kits --no-verify-jwt
 * Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
// @ts-expect-error npm: specifier resolved at edge runtime
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RecommendationOut = {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  supplier: string | null;
  category: string | null;
  subcategory: string | null;
  priceSource: "project" | "contract" | null;
  listPrice: number | null;
};

type KitOut = {
  kitId: string;
  slug: string;
  name: string;
  trade: string;
  description: string;
  similarity: number;
  items: RecommendationOut[];
  unmatched: string[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // @ts-expect-error Deno global at edge runtime
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    // @ts-expect-error Deno global at edge runtime
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    // @ts-expect-error Deno global at edge runtime
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!OPENAI_API_KEY) return jsonError(500, "OPENAI_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonError(500, "Supabase service role credentials are not configured");
    }

    let body: {
      query?: string;
      projectId?: string | null;
      areaM2?: number | null;
      matchCount?: number;
    } = {};
    try {
      const raw = await req.text();
      if (!raw || !raw.trim()) return jsonError(400, "Request body is empty");
      body = JSON.parse(raw);
    } catch (e) {
      console.error("[search-kits] bad JSON", e);
      return jsonError(400, "Invalid JSON in request body");
    }

    const query = (body.query || "").trim();
    if (!query) return jsonError(400, "Missing 'query'");
    const projectId = typeof body.projectId === "string" ? body.projectId : null;
    const areaM2 =
      typeof body.areaM2 === "number" && Number.isFinite(body.areaM2) && body.areaM2 > 0
        ? body.areaM2
        : null;
    const matchCount =
      typeof body.matchCount === "number" && Number.isFinite(body.matchCount)
        ? Math.min(5, Math.max(1, Math.round(body.matchCount)))
        : 3;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const embedding = await embedQuery(OPENAI_API_KEY, query);
    if (!embedding) return jsonError(500, "Failed to embed query");

    const { data: kitMatches, error: rpcErr } = await supabase.rpc("match_kits", {
      query_embedding: embedding,
      match_count: matchCount,
    });
    if (rpcErr) {
      console.error("[search-kits] match_kits error", rpcErr);
      return jsonError(500, rpcErr.message);
    }

    const kits: KitOut[] = [];
    for (const kit of (kitMatches ?? []) as Array<{
      kit_id: string;
      slug: string;
      name: string;
      trade: string;
      description: string;
      similarity: number;
      items: Array<{
        product_id: string;
        product_name: string;
        unit: string;
        per_m2: number | null;
        base_qty: number;
      }>;
    }>) {
      const items: RecommendationOut[] = [];
      const unmatched: string[] = [];
      for (const it of kit.items ?? []) {
        const qty = computeQuantity(it.per_m2, it.base_qty, areaM2);
        if (qty <= 0) continue;
        const resolved = await resolveProduct(supabase, it.product_name, projectId);
        if (!resolved) {
          unmatched.push(it.product_name);
          continue;
        }
        items.push({
          productId: resolved.id,
          name: resolved.product_name ?? it.product_name,
          sku: resolved.family_key ?? null,
          unit: it.unit || resolved.unit || "Stk",
          quantity: qty,
          unitPrice: resolved.price,
          supplier: resolved.supplierName,
          category: resolved.category,
          subcategory: resolved.subcategory,
          priceSource: resolved.priceSource,
          listPrice: resolved.listPrice,
        });
      }
      kits.push({
        kitId: kit.kit_id,
        slug: kit.slug,
        name: kit.name,
        trade: kit.trade,
        description: kit.description,
        similarity: kit.similarity,
        items,
        unmatched,
      });
    }

    return new Response(JSON.stringify({ kits }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[search-kits] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

function computeQuantity(
  perM2: number | null,
  baseQty: number,
  areaM2: number | null,
): number {
  if (perM2 && perM2 > 0 && areaM2 && areaM2 > 0) {
    return Math.max(1, Math.ceil(perM2 * areaM2));
  }
  if (baseQty > 0) return Math.max(1, Math.ceil(baseQty));
  return perM2 && perM2 > 0 ? 1 : 0;
}

type ResolvedProduct = {
  id: string;
  product_name: string | null;
  family_key: string | null;
  unit: string | null;
  category: string | null;
  subcategory: string | null;
  price: number | null;
  priceSource: "project" | "contract" | null;
  supplierName: string | null;
  listPrice: number | null;
};

async function resolveProduct(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string,
  projectId: string | null,
): Promise<ResolvedProduct | null> {
  const select =
    "id, product_name, family_name, family_key, unit, category, subcategory, supplier_product_mapping(contract_price, project_prices, supplier_id, suppliers(name))";
  const patterns = buildIlikePatterns(name);
  for (const pattern of patterns) {
    const { data, error } = await supabase
      .from("normalized_products")
      .select(select)
      .or(`product_name.ilike.${pattern},family_name.ilike.${pattern}`)
      .limit(5);
    if (error) {
      console.error("[search-kits] product lookup error", error.message);
      continue;
    }
    if (data && data.length > 0) {
      const row = data[0];
      const { price, priceSource, supplierName, listPrice } = pickBestPrice(
        row.supplier_product_mapping,
        projectId,
      );
      return {
        id: row.id,
        product_name: row.product_name,
        family_key: row.family_key,
        unit: row.unit,
        category: row.category,
        subcategory: row.subcategory,
        price,
        priceSource,
        supplierName,
        listPrice,
      };
    }
  }
  return null;
}

function buildIlikePatterns(name: string): string[] {
  const escaped = name.replace(/[%_,()]/g, (m) => `\\${m}`);
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const out = new Set<string>();
  out.add(`%${escaped}%`);
  if (tokens.length >= 2) out.add(`%${tokens.slice(0, 2).join("%")}%`);
  if (tokens.length >= 1) out.add(`%${tokens[0]}%`);
  return Array.from(out);
}

type SupplierMappingRow = {
  supplier_id: string | null;
  contract_price: number | null;
  project_prices: Record<string, number | string | null> | null;
  suppliers?: { name: string | null } | null;
};

function pickBestPrice(
  rows: SupplierMappingRow[] | null | undefined,
  projectId: string | null,
): {
  price: number | null;
  priceSource: "project" | "contract" | null;
  supplierName: string | null;
  listPrice: number | null;
} {
  if (!rows || rows.length === 0)
    return { price: null, priceSource: null, supplierName: null, listPrice: null };
  let best:
    | {
        price: number;
        priceSource: "project" | "contract";
        supplierName: string | null;
        contractPrice: number | null;
      }
    | null = null;
  for (const r of rows) {
    let resolved: { price: number; source: "project" | "contract" } | null = null;
    if (projectId && r.project_prices && typeof r.project_prices === "object") {
      const raw = (r.project_prices as Record<string, unknown>)[projectId];
      const n = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(n) && n > 0) resolved = { price: n, source: "project" };
    }
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
          typeof r.contract_price === "number" && r.contract_price > 0 ? r.contract_price : null,
      };
    }
  }
  if (!best) return { price: null, priceSource: null, supplierName: null, listPrice: null };
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
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
