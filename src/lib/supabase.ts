import { createClient } from "@supabase/supabase-js";

// Publishable key is safe to commit (RLS protects your data).
const HARDCODED_ANON = "sb_publishable_cd0yZjoFZTMvMbRvu-m5zQ_hQFF0pyr";

// TODO: Replace with your actual Supabase project URL (https://<project-ref>.supabase.co).
// Falls back to the env var VITE_SUPABASE_URL if set as a build secret.
const HARDCODED_URL = "https://qzmadzboeabcvficrgwa.supabase.co";

const url =
  HARDCODED_URL || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const anon =
  HARDCODED_ANON || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] Supabase URL or anon key is missing. Smart search will be disabled until both are set."
  );
}

export const supabase = createClient(url || "http://localhost", anon || "public-anon-placeholder", {
  auth: { persistSession: false },
});

export const isSupabaseConfigured = Boolean(url && anon);
