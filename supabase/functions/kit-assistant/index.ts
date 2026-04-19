/**
 * kit-assistant
 * ----------------------------------------------------------------------------
 * Fresh edge function (separate name → forces a clean deploy, sidestepping
 * any stale `construction-agent` deployment).
 *
 * Actions (dispatched by `action` in the request body):
 *   action: "search"   → { query: string, areaM2?: number, projectId?: string,
 *                          matchCount?: number, matchThreshold?: number }
 *   action: "sync"     → no body fields required. Re-embeds all kits whose
 *                        `embedding` column is NULL. Pass { force: true } to
 *                        re-embed all rows.
 *   action: "diagnose" → no body fields. Returns row counts for the kits table
 *                        so the UI can show "X von Y Kits haben Embeddings".
 *
 * Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.103.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUILD_VERSION = "kit-assistant-v1-2026-04-19";
const DEFAULT_MATCH_THRESHOLD = 0.2;
const DEFAULT_MATCH_COUNT = 5;

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log(`[kit-assistant] build=${BUILD_VERSION} method=${req.method}`);

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!OPENAI_API_KEY) return jsonError(500, "OPENAI_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonError(500, "Supabase service role credentials are not configured");
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (raw && raw.trim()) body = JSON.parse(raw);
    } catch (parseErr) {
      console.error("[kit-assistant] failed to parse JSON body", parseErr);
      return jsonError(400, "Invalid JSON in request body");
    }

    const action =
      (typeof body.action === "string" ? body.action.trim().toLowerCase() : "") || "search";
    console.log(`[kit-assistant] action=${action} bodyKeys=${Object.keys(body).join(",")}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (action === "diagnose") {
      return await handleDiagnose(supabase);
    }
    if (action === "sync") {
      const force = body.force === true;
      return await handleSync(supabase, OPENAI_API_KEY, force);
    }
    if (action === "search") {
      return await handleSearch(supabase, OPENAI_API_KEY, body);
    }

    return jsonError(400, `Unknown action '${action}'. Expected: search | sync | diagnose`);
  } catch (e) {
    console.error("[kit-assistant] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

// ----- diagnose -------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function handleDiagnose(supabase: any): Promise<Response> {
  const totalRes = await supabase.from("kits").select("id", { count: "exact", head: true });
  const withEmbRes = await supabase
    .from("kits")
    .select("id", { count: "exact", head: true })
    .not("embedding", "is", null);

  if (totalRes.error) return jsonError(500, `count total failed: ${totalRes.error.message}`);
  if (withEmbRes.error)
    return jsonError(500, `count embeddings failed: ${withEmbRes.error.message}`);

  return jsonOk({
    total: totalRes.count ?? 0,
    withEmbedding: withEmbRes.count ?? 0,
    build: BUILD_VERSION,
  });
}

// ----- sync -----------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function handleSync(supabase: any, openaiKey: string, force: boolean): Promise<Response> {
  type KitRow = {
    id: string;
    slug: string;
    name: string;
    trade: string | null;
    description: string | null;
    keywords: string[] | null;
    search_keywords: string[] | string | null;
    task_description: string | null;
    embedding: unknown;
  };

  let q = supabase
    .from("kits")
    .select("id, slug, name, trade, description, keywords, search_keywords, task_description, embedding");
  if (!force) q = q.is("embedding", null);

  const { data, error } = await q;
  if (error) {
    // Fallback for older schema without search_keywords / task_description.
    console.warn("[kit-assistant:sync] rich select failed:", error.message);
    let q2 = supabase.from("kits").select("id, slug, name, description, keywords, embedding");
    if (!force) q2 = q2.is("embedding", null);
    const fallback = await q2;
    if (fallback.error) return jsonError(500, fallback.error.message);
    return await embedAndUpdate(supabase, openaiKey, (fallback.data ?? []) as KitRow[]);
  }
  return await embedAndUpdate(supabase, openaiKey, (data ?? []) as KitRow[]);
}

// deno-lint-ignore no-explicit-any
async function embedAndUpdate(supabase: any, openaiKey: string, kits: any[]): Promise<Response> {
  if (kits.length === 0) {
    return jsonOk({ updated: 0, failed: [], total: 0, build: BUILD_VERSION });
  }
  let updated = 0;
  const failed: string[] = [];
  for (const kit of kits) {
    try {
      const text = buildEmbeddingText(kit);
      if (!text.trim()) {
        failed.push(`${kit.slug}: empty source text`);
        continue;
      }
      const embedding = await embedText(openaiKey, text);
      if (!embedding) {
        failed.push(`${kit.slug}: empty embedding response`);
        continue;
      }
      const upd = await supabase.from("kits").update({ embedding }).eq("id", kit.id);
      if (upd.error) failed.push(`${kit.slug}: ${upd.error.message}`);
      else updated++;
    } catch (e) {
      failed.push(`${kit.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return jsonOk({ updated, failed, total: kits.length, build: BUILD_VERSION });
}

// ----- search ---------------------------------------------------------------
async function handleSearch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  openaiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return jsonError(400, "Missing 'query' for search action");

  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const areaM2 =
    typeof body.areaM2 === "number" && Number.isFinite(body.areaM2) && body.areaM2 > 0
      ? (body.areaM2 as number)
      : null;
  const matchCount =
    typeof body.matchCount === "number" && Number.isFinite(body.matchCount)
      ? Math.min(5, Math.max(1, Math.round(body.matchCount as number)))
      : DEFAULT_MATCH_COUNT;
  const matchThreshold =
    typeof body.matchThreshold === "number" && Number.isFinite(body.matchThreshold)
      ? Math.max(0, Math.min(1, body.matchThreshold as number))
      : DEFAULT_MATCH_THRESHOLD;

  const embedding = await embedText(openaiKey, query);
  if (!embedding) return jsonError(500, "Failed to embed query");

  const matches = await callMatchKits(supabase, embedding, matchCount, matchThreshold);
  if (matches === null) return jsonError(502, "API Connection Error: match_kits RPC failed");

  const kits = [];
  for (const kit of matches as Array<{
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

  return jsonOk({
    kits,
    debug: {
      query,
      embeddingLength: embedding.length,
      rawMatchCount: matches.length,
      threshold: matchThreshold,
      build: BUILD_VERSION,
    },
  });
}

// ----- helpers --------------------------------------------------------------
async function embedText(apiKey: string, input: string): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });
  if (!res.ok) {
    const details = await res.text();
    console.error("[kit-assistant] embed failed", res.status, details);
    return null;
  }
  const json = await res.json();
  return json?.data?.[0]?.embedding ?? null;
}

async function callMatchKits(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  embedding: number[],
  matchCount: number,
  matchThreshold: number,
  // deno-lint-ignore no-explicit-any
): Promise<any[] | null> {
  const v2 = await supabase.rpc("match_kits", {
    query_embedding: embedding,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });
  if (!v2.error) return v2.data ?? [];

  const msg = String(v2.error.message ?? "");
  if (
    msg.includes("match_threshold") ||
    (msg.toLowerCase().includes("function") && msg.toLowerCase().includes("does not exist"))
  ) {
    console.warn("[kit-assistant] match_kits v2 missing, falling back to v1:", msg);
    const v1 = await supabase.rpc("match_kits", {
      query_embedding: embedding,
      match_count: matchCount,
    });
    if (v1.error) return null;
    // deno-lint-ignore no-explicit-any
    return ((v1.data ?? []) as any[]).filter(
      (r) => typeof r.similarity === "number" && r.similarity >= matchThreshold,
    );
  }
  console.error("[kit-assistant] match_kits error", v2.error);
  return null;
}

function buildEmbeddingText(kit: {
  name?: string | null;
  trade?: string | null;
  description?: string | null;
  task_description?: string | null;
  search_keywords?: string[] | string | null;
  keywords?: string[] | null;
}): string {
  const parts: string[] = [];
  if (kit.name) parts.push(kit.name);
  if (kit.trade) parts.push(kit.trade);
  if (kit.task_description) parts.push(kit.task_description);
  if (kit.description) parts.push(kit.description);
  const sk = normalizeKeywordList(kit.search_keywords);
  if (sk.length > 0) parts.push(sk.join(", "));
  const kw = normalizeKeywordList(kit.keywords);
  if (kw.length > 0) parts.push(kw.join(", "));
  return parts.filter(Boolean).join(". ");
}

function normalizeKeywordList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

function computeQuantity(perM2: number | null, baseQty: number, areaM2: number | null): number {
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
    if (error) continue;
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
    | { price: number; priceSource: "project" | "contract"; supplierName: string | null; contractPrice: number | null }
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
    best.priceSource === "project" && best.contractPrice !== null && best.contractPrice > best.price
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

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
