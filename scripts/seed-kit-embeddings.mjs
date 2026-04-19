/**
 * seed-kit-embeddings.mjs
 * ----------------------------------------------------------------------------
 * One-shot script: loops through every row in public.kits, generates an
 * OpenAI text-embedding-3-small vector from "<name>. <trade>. <task_description>. <search_keywords>",
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
  // search_keywords is the new richer keyword column. Try a wide select first
  // and gracefully fall back if the column does not exist yet.
  const wide = `${SUPABASE_URL}/rest/v1/kits?select=id,slug,name,trade,description,keywords,search_keywords,task_description`;
  let res = await fetch(wide, { headers: restHeaders });
  if (!res.ok) {
    console.warn("Wide select failed, retrying without new columns…");
    const url = `${SUPABASE_URL}/rest/v1/kits?select=id,slug,name,trade,description,keywords`;
    res = await fetch(url, { headers: restHeaders });
    if (!res.ok) throw new Error(`Fetch kits failed: ${res.status} ${await res.text()}`);
  }
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

const toList = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

const buildText = (kit) =>
  [
    kit.name,
    kit.trade,
    kit.task_description,
    kit.description,
    toList(kit.search_keywords).join(", "),
    toList(kit.keywords).join(", "),
  ]
    .filter(Boolean)
    .join(". ");

if (typeof buildText !== "function") {
  throw new Error("Embedding sync misconfigured: buildText is unavailable");
}

const kits = await fetchKits();
console.log(`Found ${kits.length} kits. Embedding…`);

for (const kit of kits) {
  const text = buildText(kit);
  if (!text.trim()) {
    throw new Error(`Kit ${kit.slug} has no searchable text for embedding sync`);
  }
  process.stdout.write(`  • ${kit.slug} … `);
  const vec = await embed(text);
  await updateEmbedding(kit.id, vec);
  console.log("ok");
}

console.log("Done. All kits have embeddings.");
