/**
 * sync-kit-embeddings
 * ----------------------------------------------------------------------------
 * Regenerates the OpenAI embeddings for every row in public.kits.
 *
 * Embedding text = "<name>. <description>. <search_keywords joined>"
 * Falls back to `keywords` (the original text[] column) when search_keywords
 * is not available — keeps old DBs compatible.
 *
 * Trigger from the admin UI ("Embeddings synchronisieren" button).
 *
 * Request:  POST {}        (no body needed)
 * Response: { synced: number, failed: number, errors?: string[] }
 *
 * Deploy: supabase functions deploy sync-kit-embeddings --no-verify-jwt
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

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Try the rich select first (with new columns). If that errors because
    // the columns don't exist, fall back to the legacy schema.
    let kits: KitRow[] = [];
    {
      const { data, error } = await supabase
        .from("kits")
        .select("id, slug, name, trade, description, keywords, search_keywords, task_description");
      if (error) {
        console.warn("[sync-kit-embeddings] rich select failed, falling back:", error.message);
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
        kits = (data ?? []) as KitRow[];
      }
    }

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const kit of kits) {
      try {
        const text = buildEmbeddingText(kit);
        const embedRes = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: text,
        });
        const embedding = embedRes.data[0]?.embedding;
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
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[sync-kit-embeddings] error", e);
    return jsonError(500, e instanceof Error ? e.message : "Unknown error");
  }
});

function buildEmbeddingText(kit: KitRow): string {
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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
