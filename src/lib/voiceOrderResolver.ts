import { supabase } from "@/lib/supabase";
import {
  buildOrFilter,
  diversifyByFamily,
  enrichProduct,
  PRODUCT_SELECT,
  PRODUCT_TABLE,
  scoreProduct,
  tokenize,
  type DbProduct,
} from "@/lib/productSearch";

export type VoiceResolveResult =
  | { kind: "none" }
  | { kind: "match"; best: DbProduct; alternatives: DbProduct[]; confidence: "high" | "low" }
  | { kind: "ambiguous"; candidates: DbProduct[] };

const MAX_CANDIDATES = 5;

/**
 * Run the same Supabase search the live hook uses, but as a single
 * one-shot async call. Returns:
 *   - "none"       → no match at all → caller shows "no product found"
 *   - "match"      → confident single best (high) or close winner (low)
 *   - "ambiguous"  → top-N within ~15% score → ask user to pick
 *
 * High-confidence rule: the top score must beat #2 by at least 25% AND
 * the top score must clear an absolute floor (>= 80). If runner-up is
 * very close, we surface the disambiguation list instead of guessing.
 */
export async function resolveVoiceProduct(phrase: string): Promise<VoiceResolveResult> {
  const term = (phrase ?? "").trim();
  if (term.length < 2) return { kind: "none" };

  const tokens = tokenize(term);
  if (tokens.length === 0) return { kind: "none" };

  const orFilter = buildOrFilter(tokens);
  const { data, error } = await supabase
    .from(PRODUCT_TABLE)
    .select(PRODUCT_SELECT)
    .or(orFilter)
    .limit(80);

  if (error) {
    console.error("[voice] resolveVoiceProduct query failed", {
      code: error.code,
      message: error.message,
    });
    throw error;
  }

  const enriched = (data ?? []).map(enrichProduct);
  const ranked = enriched
    .map((p) => ({ p, score: scoreProduct(p, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { kind: "none" };

  const diversified = diversifyByFamily(ranked, MAX_CANDIDATES);
  if (diversified.length === 0) return { kind: "none" };

  const top = diversified[0];
  const topScore = scoreProduct(top, tokens);

  // Single candidate → auto-add. Anything else → always ask the user
  // to pick. Voice utterances like "Schrauben" or "screws" almost
  // always map to several SKUs that differ only in size/spec, so
  // surfacing the chooser is the only safe behaviour.
  if (diversified.length === 1) {
    return {
      kind: "match",
      best: top,
      alternatives: [],
      confidence: topScore >= 80 ? "high" : "low",
    };
  }

  return { kind: "ambiguous", candidates: diversified };
}
