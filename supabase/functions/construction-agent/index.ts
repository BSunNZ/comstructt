/**
 * construction-agent
 * ----------------------------------------------------------------------------
 * Agentic chat endpoint powered by GPT-4o-mini with one tool:
 *   - search_database_for_kits(task_description, area_m2?) → embeds the query
 *     with text-embedding-3-small, calls the `match_kits` Postgres RPC
 *     (pgvector cosine similarity), then RESOLVES every kit_items.product_name
 *     against `normalized_products` (ILIKE) so we always return real product
 *     UUIDs the client can drop straight into the cart.
 *
 * Response shape (NEW — structured):
 *   {
 *     reply: string,                 // markdown answer for the chat bubble
 *     recommendations?: [{           // when a kit was matched + sized
 *       productId, name, sku, unit, quantity,
 *       unitPrice, supplier, category, subcategory,
 *       priceSource: "project" | "contract" | null,
 *       listPrice
 *     }]
 *   }
 *
 * Important guard from the system prompt: if the user asks for "drywall"
 * without a size, the model is instructed to ask back for m² before
 * recommending quantities.
 *
 * Deploy:
 *   supabase functions deploy construction-agent --no-verify-jwt
 * Required secrets: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
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

// Module-level cache so the resolved recommendations from the most recent
// tool call are attached to the final HTTP response. We rebuild it on
// every request so concurrent invocations don't cross-pollute.
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

    let body: { messages?: ChatMessage[]; projectId?: string | null } = {};
    try {
      const raw = await req.text();
      if (!raw || !raw.trim()) {
        return jsonError(400, "Request body is empty. Expected JSON: { messages: [...] }");
      }
      body = JSON.parse(raw);
    } catch (parseErr) {
      console.error("[construction-agent] failed to parse JSON body", parseErr);
      return jsonError(400, "Invalid JSON in request body");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonError(400, "Missing 'messages' array in request body");
    }

    const projectId = typeof body.projectId === "string" ? body.projectId : null;

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...body.messages,
    ];

    // Per-request state — last successful tool call's resolved items.
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
          openai,
          supabase,
          taskDescription,
          areaM2,
          projectId,
        );

        // Stash the resolved recommendations so we can return them to the
        // client alongside the model's final natural-language reply.
        if (toolResult.recommendations && toolResult.recommendations.length > 0) {
          state.recommendations = toolResult.recommendations;
        }

        // Send a leaner payload back to the model — it only needs to know
        // names + quantities to write the reply, not full UUIDs.
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
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[construction-agent] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

async function runMatchKits(
  openai: OpenAI,
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
  // 1. Embed task and run pgvector cosine similarity.
  const embedRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: taskDescription,
  });
  const embedding = embedRes.data[0]?.embedding;
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

  const { data: kitMatches, error: rpcErr } = await supabase.rpc("match_kits", {
    query_embedding: embedding,
    match_count: 1,
  });
  if (rpcErr) {
    console.error("[construction-agent] match_kits RPC error", rpcErr);
    return {
      kitName: null,
      trade: null,
      areaM2,
      recommendations: [],
      unmatched: [],
      message: rpcErr.message,
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

  // 2. For every kit item, resolve the real product row by name. We only
  //    use kit_items.product_name (the demo product_id strings are not
  //    real UUIDs in normalized_products). ILIKE on product_name with a
  //    fallback to family_name keeps it tolerant of small naming drifts.
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

/** Round up to whole units, falling back to base_qty when no area given. */
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

/** Find a real normalized_products row whose name best matches `name`. */
async function resolveProduct(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string,
  projectId: string | null,
): Promise<ResolvedProduct | null> {
  const select =
    "id, product_name, family_name, family_key, unit, category, subcategory, supplier_product_mapping(contract_price, project_prices, supplier_id, suppliers(name))";

  // Try a few progressively looser ilike patterns.
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

/** Build ilike patterns: full string → first 3 significant tokens → first token. */
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

/** Same project-aware pricing rule used by the frontend (productSearch.ts). */
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
