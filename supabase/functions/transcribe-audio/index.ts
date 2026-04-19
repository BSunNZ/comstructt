/**
 * transcribe-audio
 * ----------------------------------------------------------------------------
 * OpenAI Whisper proxy for the mobile voice-order flow.
 *
 * Receives a base64-encoded audio blob from the client (recorded via
 * MediaRecorder), forwards it to OpenAI's `whisper-1` endpoint as multipart
 * form data, and returns the transcript.
 *
 * Why a base64 JSON payload (not raw multipart from the browser):
 *   - Mobile browsers vary wildly on FormData/Blob handling inside fetch
 *     bodies; sending a JSON string is the most reliable transport.
 *   - Keeps the edge function easy to test with curl.
 *
 * Whisper tuning for this app:
 *   - language: "de" — German is the primary site language.
 *   - prompt: a short German construction-vocabulary glossary that biases
 *     Whisper toward correct spellings of materials, fasteners and units.
 *   - temperature: 0 — fully deterministic, best for short commands.
 *
 * Deploy: this function is stored at supabase/functions/transcribe-audio.
 * It expects an `OPENAI_API_KEY` secret in the Supabase project. CORS is
 * fully open because the app is a public SPA.
 */
// @ts-expect-error Deno std import resolved at edge runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// German construction-site vocabulary primer. Whisper uses this as a soft
// hint to prefer these spellings. Keep it short — long prompts cost tokens
// and can hurt accuracy on out-of-vocabulary words.
const GERMAN_CONSTRUCTION_PROMPT = [
  "Kauf, kaufe, kaufen, einkaufen, Einkauf, Kauf bitte, kauf mir.",
  "Bestell, bestelle, bestellen, Bestellung, nachbestellen, Nachbestellung, bestell bitte.",
  "Beispiele: Kauf zehn Schrauben. Bestelle fünf Säcke Zement. Kauf bitte Silikon.",
  "Baustelle, Lieferung, Stück, Packung, Karton, Rolle, Sack, Eimer.",
  "Schrauben, Dübel, Nägel, Spax, TX20, TX25, Torx, Kreuzschlitz.",
  "Gipskarton, Rigips, Trockenbau, Spachtel, Fugenband, CD-Profil, UD-Profil.",
  "Beton, Estrich, Mörtel, Bewehrung, Rödeldraht.",
  "Kabel NYM-J, Wago, Klemme, Sicherung, Steckdose.",
  "PEX-Rohr, PTFE-Band, Fitting, Muffe.",
  "Dachpappe, Unterspannbahn, Dachziegel.",
  "4x40, 5x60, 3,5x35, 16mm, 75mm.",
].join(" ");

// Whisper sometimes drops the leading hard 'K' of "Kauf" (hearing "auf")
// or splits "bestell" into "be stell". Normalize the most common cases so
// downstream intent parsing always sees clean command verbs.
function normalizeCommandWords(text: string): string {
  if (!text) return text;
  let out = text;

  // Leading "auf" → "Kauf" (most common drop of the hard K)
  out = out.replace(/^(\s*)auf\b/i, (_m, ws) => `${ws}Kauf`);
  // After sentence punctuation: ". auf" → ". Kauf"
  out = out.replace(/([.!?]\s+)auf\b/g, (_m, p) => `${p}Kauf`);
  // "kauft mir/uns/bitte/mal" → "kauf …" (stray 't' from Whisper)
  out = out.replace(/\bkauft\b(?=\s+(mir|uns|bitte|mal|noch))/gi, (m) =>
    m[0] === "K" ? "Kauf" : "kauf",
  );
  // "be stell" / "be-stell" → "bestell" (with optional suffix)
  out = out.replace(
    /\bbe[\s-]stell(e|t|en|ung|ungen)?\b/gi,
    (_m, suf = "") => `bestell${suf || ""}`,
  );
  // "be stelle" → "bestelle"
  out = out.replace(/\bbe[\s-]stelle\b/gi, "bestelle");

  return out;
}

// Decode a base64 string to a Uint8Array without blowing the stack on
// large recordings. atob → binary string → Uint8Array.
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // @ts-expect-error Deno global at edge runtime
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as {
      audio?: string; // base64
      mimeType?: string; // e.g. "audio/webm"
      language?: string; // ISO-639-1, defaults to "de"
    };

    if (!body.audio || typeof body.audio !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'audio' (base64 string) in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mime = body.mimeType || "audio/webm";
    // Pick a sensible filename extension so OpenAI infers the codec.
    const ext = mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("mpeg")
            ? "mp3"
            : "webm";

    const bytes = base64ToBytes(body.audio);
    const audioBlob = new Blob([bytes], { type: mime });

    const form = new FormData();
    form.append("file", audioBlob, `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", body.language || "de");
    form.append("temperature", "0");
    form.append("prompt", GERMAN_CONSTRUCTION_PROMPT);
    form.append("response_format", "json");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("[transcribe-audio] Whisper error", whisperRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Whisper request failed (${whisperRes.status})`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = (await whisperRes.json()) as { text?: string };
    return new Response(JSON.stringify({ text: data.text ?? "" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[transcribe-audio] unexpected error", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
