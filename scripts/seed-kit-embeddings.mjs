/**
 * seed-kit-embeddings.mjs
 * ----------------------------------------------------------------------------
 * One-shot script: loops through every row in public.kits, generates an
 * OpenAI text-embedding-3-small vector from "<name>. <trade>. <keywords>",
 * and writes it back into the embedding column.
 *
 * Run ONCE after applying the construction_agent_kits migration:
 *
 *   export OPENAI_API_KEY=sk-...
 *   export SUPABASE_URL=https://<project-ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service role, NOT anon
 *   node scripts/seed-kit-embeddings.mjs
 *
 * Requires Node 18+ (built-in fetch). No npm install needed — uses the
 * Supabase REST API directly so you don't have to add @supabase/supabase-js
 * to the project.
 */

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing env. Please export OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const restHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function fetchKits() {
  const url = `${SUPABASE_URL}/rest/v1/kits?select=id,slug,name,trade,keywords`;
  const res = await fetch(url, { headers: restHeaders });
  if (!res.ok) throw new Error(`Fetch kits failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function embed(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data[0].embedding;
}

async function updateEmbedding(id, embedding) {
  const url = `${SUPABASE_URL}/rest/v1/kits?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ embedding }),
  });
  if (!res.ok) throw new Error(`Update failed for ${id}: ${res.status} ${await res.text()}`);
}

const kits = await fetchKits();
console.log(`Found ${kits.length} kits. Embedding…`);

for (const kit of kits) {
  const text = `${kit.name}. ${kit.trade}. ${(kit.keywords || []).join(", ")}`;
  process.stdout.write(`  • ${kit.slug} … `);
  const vec = await embed(text);
  await updateEmbedding(kit.id, vec);
  console.log("ok");
}

console.log("Done. All kits have embeddings.");
