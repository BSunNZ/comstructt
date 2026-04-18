import fs from "fs";

const SUPABASE_URL = "https://qzmadzboeabcvficrgwa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWFkemJvZWFiY3ZmaWNyZ3dhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNzExMiwiZXhwIjoyMDkyMDkzMTEyfQ.sa_p0GaypzO-8Qy9KOSPzFuBp26qJ1A7p0Hfsj72_M0";

async function run() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });
  
  if (!response.ok) {
    console.error("Failed to fetch schema", await response.text());
    return;
  }
  
  const schema = await response.json();
  const tables = ["raw_imports", "raw_product_rows", "normalized_products", "supplier_product_mapping", "suppliers"];
  
  const output = {};
  for (const table of tables) {
    output[table] = schema.definitions[table]?.properties || "Table not found";
  }
  
  fs.writeFileSync("schema_output.json", JSON.stringify(output, null, 2));
  console.log("Schema saved to schema_output.json");
}

run();
