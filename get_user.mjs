import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qzmadzboeabcvficrgwa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWFkemJvZWFiY3ZmaWNyZ3dhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNzExMiwiZXhwIjoyMDkyMDkzMTEyfQ.sa_p0GaypzO-8Qy9KOSPzFuBp26qJ1A7p0Hfsj72_M0";

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  const { data: { users }, error } = await db.auth.admin.listUsers();
  if (error) {
    console.error("Error fetching users", error);
    return;
  }
  
  if (users.length > 0) {
    console.log("Found user:", users[0].id);
  } else {
    console.log("No users found. Creating dummy user...");
    const { data: user, error: err2 } = await db.auth.admin.createUser({
      email: 'system.import@comstruct.com',
      password: 'password123',
      email_confirm: true
    });
    if (err2) {
        console.log("Failed to create:", err2);
    } else {
        console.log("Created user:", user.user.id);
    }
  }
}

run();
