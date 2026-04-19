/**
 * construction-agent
 * ----------------------------------------------------------------------------
 * Agentic chat endpoint powered by GPT-4o-mini with one tool:
 *   - search_database_for_kits(task_description) → embeds the query with
 *     text-embedding-3-small and calls the `match_kits` Postgres RPC
 *     (pgvector cosine similarity) to return the best-matching kit.
 *
 * Conversation flow:
 *   client → POST { messages: [...] } → this function
 *   ↓
 *   GPT-4o-mini decides whether to answer directly or call the tool.
 *   ↓ (if tool call)
 *   We embed task_description, run match_kits RPC, feed result back to model.
 *   ↓
 *   Model produces a natural-language answer; we return it to the client.
 *
 * Important guard from the system prompt: if the user asks for "drywall"
 * without a size, the model is instructed to ask back for m² before
 * recommending quantities. This is the agentic behaviour the brief asks for.
 *
 * Deploy: copy to your Supabase project under
 *   supabase/functions/construction-agent/index.ts
 * then run `supabase functions deploy construction-agent --no-verify-jwt`.
 * Requires the OPENAI_API_KEY secret.
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
- If the user asks for materials for a task, ALWAYS use the search_database_for_kits tool to find the right kit.
- If the user does not specify a size (e.g. m², meters, pieces), ASK them for the size BEFORE recommending quantities. Example: "Wie viele m² Trockenbau brauchst du?"
- After you have the size, call the tool with a clear task_description that includes the trade keyword (e.g. "drywall wall 50 m2", "electrical wiring rough-in").
- When presenting the kit, list the items as a short markdown bullet list with quantities scaled to the size the user gave you.
- Round all quantities UP to the next whole unit.
- Never invent products or quantities — only use what the tool returns.
- If the tool returns no useful match, say so and suggest the user search manually.`;

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
        "Search the construction kit database for the best-matching kit for a given task. Returns the kit name, trade, and a list of items with their per-m² scaling factors so you can compute final quantities.",
      parameters: {
        type: "object",
        properties: {
          task_description: {
            type: "string",
            description:
              "A short description of the construction task, including trade and any size hint. Example: 'drywall wall 50 m2' or 'electrical rough-in apartment'.",
          },
        },
        required: ["task_description"],
        additionalProperties: false,
      },
    },
  },
];

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

    if (!OPENAI_API_KEY) {
      return jsonError(500, "OPENAI_API_KEY is not configured");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonError(500, "Supabase service role credentials are not configured");
    }

    // Safely parse JSON body — empty body or malformed JSON should yield 400,
    // not crash the function with "Unexpected end of JSON input".
    let body: { messages?: ChatMessage[] } = {};
    try {
      const raw = await req.text();
      if (!raw || !raw.trim()) {
        return jsonError(400, "Request body is empty. Expected JSON: { messages: [...] }");
      }
      body = JSON.parse(raw) as { messages?: ChatMessage[] };
    } catch (parseErr) {
      console.error("[construction-agent] failed to parse JSON body", parseErr);
      return jsonError(400, "Invalid JSON in request body");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonError(400, "Missing 'messages' array in request body");
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Conversation buffer we keep mutating across tool-call iterations.
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...body.messages,
    ];

    // Cap iterations so a runaway model can't loop forever.
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

      // Push the assistant turn (with tool_calls if present) into the buffer.
      conversation.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls as ChatMessage["tool_calls"],
      });

      // No tool call → we have the final answer.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalText = msg.content ?? "";
        break;
      }

      // Execute every tool call sequentially. (We only define one tool today,
      // but the loop is generic so adding more later is trivial.)
      for (const call of msg.tool_calls) {
        if (call.function.name !== "search_database_for_kits") {
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
          });
          continue;
        }

        let parsedArgs: { task_description?: string } = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* fall through with empty args */
        }
        const taskDescription = (parsedArgs.task_description || "").trim();

        if (!taskDescription) {
          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "task_description is required" }),
          });
          continue;
        }

        const toolResult = await runMatchKits(openai, supabase, taskDescription);
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    if (!finalText) {
      finalText =
        "Entschuldigung — ich konnte gerade keine Antwort generieren. Bitte nochmal versuchen.";
    }

    return new Response(JSON.stringify({ reply: finalText }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[construction-agent] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

async function runMatchKits(
  openai: OpenAI,
  supabase: ReturnType<typeof createClient>,
  taskDescription: string,
) {
  // 1. Embed the task description with the same model used to seed kits.
  const embedRes = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: taskDescription,
  });
  const embedding = embedRes.data[0]?.embedding;
  if (!embedding) {
    return { error: "Failed to embed task description" };
  }

  // 2. Ask Postgres for the closest kit via pgvector cosine distance.
  const { data, error } = await supabase.rpc("match_kits", {
    query_embedding: embedding,
    match_count: 1,
  });

  if (error) {
    console.error("[construction-agent] match_kits RPC error", error);
    return { error: error.message };
  }
  if (!data || data.length === 0) {
    return { kit: null, message: "No matching kit found in the database." };
  }

  // 3. Return the kit in a model-friendly shape. The system prompt tells
  //    the model how to scale per_m2 quantities by the size the user gave.
  return { kit: data[0] };
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
