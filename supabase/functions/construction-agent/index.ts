/**
 * construction-agent (multi-action)
 * ----------------------------------------------------------------------------
 * Single edge function that handles three actions, dispatched by `action` in
 * the request body. Merged here because the Supabase CLI is unavailable on
 * the user's machine and only this function is reliably deployed.
 *
 *   action: "chat"   (default) — agentic GPT-4o-mini chat with search tool.
 *   action: "search"           — direct semantic kit search (no LLM loop).
 *   action: "sync"             — regenerate OpenAI embeddings for all kits.
 *
 * All three share the same OpenAI + Supabase clients and helper utilities
 * (embed query, match_kits RPC, resolve product, project-aware pricing).
 *
 * Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Deploy trigger: 2026-04-19T12:48 — force redeploy after merging search/sync (v3).
 */
// @ts-expect-error Deno std import resolved at edge runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// @ts-expect-error npm: specifier resolved at edge runtime
import OpenAI from "npm:openai@4.73.0";
// @ts-expect-error esm.sh import resolved at edge runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are an expert construction assistant helping a German construction crew on-site.

You help them figure out which materials they need for a task. You speak the user's language (German or English) and keep answers SHORT, practical, and friendly — like a foreman, not a textbook.

Rules:
- If the user asks for materials for a task, ALWAYS use the search_database_for_kits tool.
- If the user does NOT specify a size (e.g. m², meters, pieces) AND the task is size-dependent (drywall, concrete, roofing, electrical wiring), ASK them for the size BEFORE calling the tool. Example: "Wie viele m² Trockenbau brauchst du?"
- Once you have the size, call the tool with task_description (trade keyword + size) AND area_m2 (number).
- The tool already returns final, scaled quantities and resolved product names — just present them.
- Format the answer as a SHORT intro sentence + a markdown bullet list: "- {quantity}× {name} ({unit})".
- Never invent products or quantities — only use what the tool returns.
- If the tool returns no products, say so and suggest the user search manually.`;

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_database_for_kits",
      description:
        "Search the construction kit database for the best-matching kit for a given task and resolve every kit item against the live product catalog. Returns real product UUIDs, names, units, supplier, project-aware unit price, and final scaled quantities (already rounded up).",
      parameters: {
        type: "object",
        properties: {
          task_description: {
            type: "string",
            description:
              "Short description of the construction task including the trade keyword. Example: 'drywall wall', 'electrical rough-in', 'concrete slab'.",
          },
          area_m2: {
            type: "number",
            description:
              "Area in square meters (or count of units) the user gave. Used to scale per_m2 quantities. Omit only if the kit has no per_m2 items.",
          },
        },
        required: ["task_description"],
        additionalProperties: false,
      },
    },
  },
];

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

type AgentState = { recommendations: RecommendationOut[] | null };

serve(async (req: Request) => {
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

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (!raw || !raw.trim()) {
        return jsonError(400, "Request body is empty.");
      }
      body = JSON.parse(raw);
    } catch (parseErr) {
      console.error("[construction-agent] failed to parse JSON body", parseErr);
      return jsonError(400, "Invalid JSON in request body");
    }

    const action = typeof body.action === "string" ? body.action : "chat";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ----- ACTION: search ---------------------------------------------------
    if (action === "search") {
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
          : 3;
      const matchThreshold =
        typeof body.matchThreshold === "number" && Number.isFinite(body.matchThreshold)
          ? Math.max(0, Math.min(1, body.matchThreshold as number))
          : 0.3;

      console.log("[construction-agent:search] query=", query, "areaM2=", areaM2, "threshold=", matchThreshold);

      const embedding = await embedText(OPENAI_API_KEY, query);
      if (!embedding) return jsonError(500, "Failed to embed query");
      console.log("[construction-agent:search] embedding length=", embedding.length);

      const kitMatches = await callMatchKits(supabase, embedding, matchCount, matchThreshold);
      console.log(
        "[construction-agent:search] raw RPC matches=",
        Array.isArray(kitMatches) ? kitMatches.length : "n/a",
        Array.isArray(kitMatches)
          ? kitMatches.map((k) => ({ slug: k.slug, sim: k.similarity }))
          : kitMatches,
      );
      if (kitMatches === null) {
        return jsonError(500, "match_kits RPC failed");
      }

      const kits = [];
      for (const kit of kitMatches as Array<{
        kit_id: string;
        slug: string;
        name: string;
        trade: string;
        description: string;
        task_description?: string | null;
        search_keywords?: string[] | null;
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

      console.log(
        "[construction-agent:search] returning kits=",
        kits.length,
        "with totalItems=",
        kits.reduce((a, k) => a + k.items.length, 0),
      );

      return new Response(
        JSON.stringify({
          kits,
          debug: {
            query,
            embeddingLength: embedding.length,
            rawMatchCount: Array.isArray(kitMatches) ? kitMatches.length : 0,
            threshold: matchThreshold,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ----- ACTION: sync -----------------------------------------------------
    if (action === "sync") {
      type KitRow = {
        id: string;
        slug: string;
        name: string;
        trade: string | null;
        description: string | null;
        keywords: string[] | null;
        search_keywords: string[] | string | null;
        task_description: string | null;
      };

      let kits: KitRow[] = [];
      const rich = await supabase
        .from("kits")
        .select("id, slug, name, trade, description, keywords, search_keywords, task_description");
      if (rich.error) {
        console.warn("[construction-agent:sync] rich select failed, falling back:", rich.error.message);
        const fallback = await supabase
          .from("kits")
          .select("id, slug, name, trade, description, keywords");
        if (fallback.error) return jsonError(500, fallback.error.message);
        kits = (fallback.data ?? []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          slug: String(r.slug),
          name: String(r.name),
          trade: (r.trade as string) ?? null,
          description: (r.description as string) ?? null,
          keywords: (r.keywords as string[]) ?? null,
          search_keywords: null,
          task_description: null,
        }));
      } else {
        kits = (rich.data ?? []) as KitRow[];
      }

      let synced = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const kit of kits) {
        try {
          const text = buildEmbeddingText(kit);
          const embedding = await embedText(OPENAI_API_KEY, text);
          if (!embedding) {
            failed++;
            errors.push(`${kit.slug}: empty embedding response`);
            continue;
          }
          const { error: updateErr } = await supabase
            .from("kits")
            .update({ embedding })
            .eq("id", kit.id);
          if (updateErr) {
            failed++;
            errors.push(`${kit.slug}: ${updateErr.message}`);
          } else {
            synced++;
          }
        } catch (e) {
          failed++;
          errors.push(`${kit.slug}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      return new Response(
        JSON.stringify({
          synced,
          failed,
          total: kits.length,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ----- ACTION: chat (default) ------------------------------------------
    const messages = body.messages as ChatMessage[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError(400, "Missing 'messages' array in request body");
    }
    const projectId = typeof body.projectId === "string" ? body.projectId : null;

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];
    const state: AgentState = { recommendations: null };

    const MAX_TOOL_ITERATIONS = 3;
    let finalText = "";

    for (let i = 0; i < MAX_TOOL_ITERATIONS + 1; i++) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversation as never,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
      });

      const choice = completion.choices[0];
      const msg = choice.message;

      conversation.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls as ChatMessage["tool_calls"],
      });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalText = msg.content ?? "";
        break;
      }

      for (const call of msg.tool_calls) {
        if (call.function.name !== "search_database_for_kits") {
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
          });
          continue;
        }

        let parsedArgs: { task_description?: string; area_m2?: number } = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* fall through with empty args */
        }
        const taskDescription = (parsedArgs.task_description || "").trim();
        const areaM2 =
          typeof parsedArgs.area_m2 === "number" && Number.isFinite(parsedArgs.area_m2)
            ? parsedArgs.area_m2
            : null;

        if (!taskDescription) {
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "task_description is required" }),
          });
          continue;
        }

        const toolResult = await runMatchKits(
          OPENAI_API_KEY,
          supabase,
          taskDescription,
          areaM2,
          projectId,
        );

        if (toolResult.recommendations && toolResult.recommendations.length > 0) {
          state.recommendations = toolResult.recommendations;
        }

        const modelView = {
          kitName: toolResult.kitName,
          trade: toolResult.trade,
          areaM2: toolResult.areaM2,
          items: (toolResult.recommendations ?? []).map((r) => ({
            name: r.name,
            quantity: r.quantity,
            unit: r.unit,
            unitPrice: r.unitPrice,
            supplier: r.supplier,
          })),
          unmatched: toolResult.unmatched,
          message: toolResult.message,
        };

        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(modelView),
        });
      }
    }

    if (!finalText) {
      finalText =
        "Entschuldigung — ich konnte gerade keine Antwort generieren. Bitte nochmal versuchen.";
    }

    return new Response(
      JSON.stringify({
        reply: finalText,
        recommendations: state.recommendations ?? undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[construction-agent] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

async function runMatchKits(
  openaiApiKey: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  taskDescription: string,
  areaM2: number | null,
  projectId: string | null,
): Promise<{
  kitName: string | null;
  trade: string | null;
  areaM2: number | null;
  recommendations: RecommendationOut[];
  unmatched: string[];
  message?: string;
}> {
  const embedding = await embedText(openaiApiKey, taskDescription);
  if (!embedding) {
    return {
      kitName: null,
      trade: null,
      areaM2,
      recommendations: [],
      unmatched: [],
      message: "Failed to embed task description",
    };
  }
  console.log("[construction-agent:chat] task=", taskDescription, "embeddingLength=", embedding.length);

  const kitMatches = await callMatchKits(supabase, embedding, 1, 0.3);
  console.log(
    "[construction-agent:chat] raw RPC matches=",
    Array.isArray(kitMatches) ? kitMatches.map((k) => ({ slug: k.slug, sim: k.similarity })) : kitMatches,
  );
  if (kitMatches === null) {
    return {
      kitName: null,
      trade: null,
      areaM2,
      recommendations: [],
      unmatched: [],
      message: "match_kits RPC failed",
    };
  }
  if (!kitMatches || kitMatches.length === 0) {
    return {
      kitName: null,
      trade: null,
      areaM2,
      recommendations: [],
      unmatched: [],
      message: "No matching kit found in the database.",
    };
  }

  const kit = kitMatches[0] as {
    kit_id: string;
    name: string;
    trade: string;
    items: Array<{
      product_id: string;
      product_name: string;
      unit: string;
      per_m2: number | null;
      base_qty: number;
    }>;
  };

  const recommendations: RecommendationOut[] = [];
  const unmatched: string[] = [];

  for (const item of kit.items) {
    const qty = computeQuantity(item.per_m2, item.base_qty, areaM2);
    if (qty <= 0) continue;

    const resolved = await resolveProduct(supabase, item.product_name, projectId);
    if (!resolved) {
      unmatched.push(item.product_name);
      continue;
    }

    recommendations.push({
      productId: resolved.id,
      name: resolved.product_name ?? item.product_name,
      sku: resolved.family_key ?? null,
      unit: item.unit || resolved.unit || "Stk",
      quantity: qty,
      unitPrice: resolved.price,
      supplier: resolved.supplierName,
      category: resolved.category,
      subcategory: resolved.subcategory,
      priceSource: resolved.priceSource,
      listPrice: resolved.listPrice,
    });
  }

  return {
    kitName: kit.name,
    trade: kit.trade,
    areaM2,
    recommendations,
    unmatched,
  };
}

async function embedText(apiKey: string, input: string): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input }),
  });
  if (!res.ok) {
    console.error("[construction-agent] embed failed", res.status, await res.text());
    return null;
  }
  const json = await res.json();
  return json?.data?.[0]?.embedding ?? null;
}

// Calls the match_kits RPC. The DB function went through two signatures:
//   v1: match_kits(query_embedding, match_count)
//   v2: match_kits(query_embedding, match_count, match_threshold)  ← current
// We try v2 first and gracefully fall back to v1 (then drop low-similarity
// matches in code) so deploys can roll out independently of the migration.
// deno-lint-ignore no-explicit-any
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
  // Function signature mismatch → old RPC still deployed. Fall back.
  if (
    msg.includes("match_threshold") ||
    msg.toLowerCase().includes("function") && msg.toLowerCase().includes("does not exist")
  ) {
    console.warn("[construction-agent] match_kits v2 missing, falling back to v1:", msg);
    const v1 = await supabase.rpc("match_kits", {
      query_embedding: embedding,
      match_count: matchCount,
    });
    if (v1.error) {
      console.error("[construction-agent] match_kits v1 also failed", v1.error);
      return null;
    }
    // deno-lint-ignore no-explicit-any
    return ((v1.data ?? []) as any[]).filter(
      (r) => typeof r.similarity === "number" && r.similarity >= matchThreshold,
    );
  }

  console.error("[construction-agent] match_kits error", v2.error);
  return null;
}

function buildEmbeddingText(kit: {
  name: string;
  trade: string | null;
  description: string | null;
  task_description: string | null;
  search_keywords: string[] | string | null;
  keywords: string[] | null;
}): string {
  const parts: string[] = [];
  if (kit.name) parts.push(kit.name);
  if (kit.trade) parts.push(kit.trade);
  if (kit.task_description) parts.push(kit.task_description);
  if (kit.description) parts.push(kit.description);

  const sk = normalizeKeywordList(kit.search_keywords);
  if (sk.length > 0) parts.push(sk.join(", "));

  const legacyKw = normalizeKeywordList(kit.keywords);
  if (legacyKw.length > 0) parts.push(legacyKw.join(", "));

  return parts.filter(Boolean).join(". ");
}

function normalizeKeywordList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

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
      console.error("[construction-agent] product lookup error", error.message);
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
