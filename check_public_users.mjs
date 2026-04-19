import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qzmadzboeabcvficrgwa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWFkemJvZWFiY3ZmaWNyZ3dhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNzExMiwiZXhwIjoyMDkyMDkzMTEyfQ.sa_p0GaypzO-8Qy9KOSPzFuBp26qJ1A7p0Hfsj72_M0";

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  const dummyId = "6792769c-f841-4715-b5f3-335a155a95bc";
  console.log("Attempting to insert dummy user into public.users...");
  const res = await db.from("users").insert([{ id: dummyId, name: "System Import User", email: "system.import@comstruct.com", role: "admin" }]);
  console.log("Insert result:", res);
}

run();
