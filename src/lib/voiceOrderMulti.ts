/**
 * Multi-item voice-order parser.
 *
 * Splits a freeform spoken phrase containing several items into individual
 * single-item intents, reusing the existing `parseVoiceOrder` for each one.
 *
 * Examples:
 *   "Order 500 screws, 20 gloves, 10 WD-40"
 *     → [{qty:500,phrase:"screws"}, {qty:20,phrase:"gloves"}, {qty:10,phrase:"WD-40"}]
 *
 *   "Bestell 500 Schrauben, 20 Handschuhe und 10 Spraydosen"
 *     → [{qty:500,phrase:"Schrauben"}, {qty:20,phrase:"Handschuhe"}, {qty:10,phrase:"Spraydosen"}]
 *
 *   "Add 50 drywall screws and 5 PVC pipes, 2 tape rolls"
 *     → [{qty:50,phrase:"drywall screws"}, {qty:5,phrase:"PVC pipes"}, {qty:2,phrase:"tape rolls"}]
 *
 * Design notes:
 * - Splits on commas, semicolons, slashes, " und ", " and ", " plus ",
 *   " sowie ". These never appear inside a typical product name, so the
 *   split is safe.
 * - Each segment inherits the leading verb of the first segment so
 *   "Order 500 screws, 20 gloves" parses both as orders. We do this by
 *   only requiring the FIRST segment to be a verb-led order; subsequent
 *   segments are forced into order mode by re-prefixing the verb.
 * - Size tokens like "4x40" or "3,5x35" stay inside their segment because
 *   we split on `, ` (comma + space) — the comma in "3,5x35" has no
 *   trailing space.
 */

import { parseVoiceOrder, type VoiceOrderIntent } from "./voiceOrderIntent";

export type MultiVoiceOrderItem = {
  quantity: number;
  productPhrase: string;
  /** The original segment text (for error/debug messages). */
  raw: string;
};

export type MultiVoiceOrderResult = {
  /** True if we detected ANY order intent (first segment had a verb or
      we matched a multi-item delimiter pattern). */
  isOrder: boolean;
  /** Parsed items (only those with a usable productPhrase). */
  items: MultiVoiceOrderItem[];
  /** Single-item fallback intent when nothing multi-item was detected. */
  fallback: VoiceOrderIntent;
};

/**
 * Split a phrase into ordered segments on comma / semicolon / "und" /
 * "and" / "plus" / "sowie".
 *
 * Comma-with-space splits avoid breaking decimal sizes like "3,5x35"
 * (no trailing space). The conjunction split is whole-word + space
 * padded so we never break inside a product name.
 */
// Words that count as a quantity at the start of a new item segment.
// Mirrors GERMAN_NUMBERS / ENGLISH_NUMBERS in voiceOrderIntent.ts (both
// the diacritic-stripped form and the ASCII transliteration).
const QUANTITY_WORDS = [
  // German 1-12
  "ein", "eine", "einen", "eins",
  "zwei", "drei", "vier",
  "funf", "fünf", "fuenf",
  "sechs", "sieben", "acht", "neun", "zehn", "elf",
  "zwolf", "zwölf", "zwoelf",
  // English 1-12
  "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "dozen",
  // Multipliers that can stand alone as a qty
  "hundert", "hundred", "tausend", "thousand",
];

/**
 * Insert a comma before each quantity-looking token that appears
 * mid-sentence so an unpunctuated voice transcript like
 *   "Schrauben 20 Handschuhe 10 Spraydosen fünf Rohr 8 Klebeband"
 * becomes
 *   "Schrauben, 20 Handschuhe, 10 Spraydosen, fünf Rohr, 8 Klebeband"
 *
 * Rules:
 * - The FIRST qty in the sentence stays attached (it belongs to item #1,
 *   e.g. "Bestell 500 Schrauben …").
 * - We never break inside size tokens (4x40, 3,5x35, 12mm, M8). The
 *   `prev` char must NOT be a digit / x / × — that excludes those.
 * - The qty must be followed by a letter (product word), not another
 *   number or a unit suffix like "mm".
 */
const insertImpliedCommas = (input: string): string => {
  const wordsAlt = QUANTITY_WORDS.join("|");
  // Capture the WHOLE previous token (group 1) plus the following qty
  // token (group 2). Looking at the whole previous token lets us tell
  // a real size token ("4x40", "3,5x35", "12mm") apart from an
  // identifier that just happens to end in a digit ("WD-40", "M8x20").
  const re = new RegExp(
    `(\\S+)\\s+((?:\\d+|${wordsAlt}))(?=\\s+[A-Za-zÀ-ÿ])`,
    "gi",
  );

  // Pure-size token: dimensional values like "4x40", "3,5x35", "12mm",
  // "10cm", "1/2"". Identifier-with-trailing-digits like "WD-40" must
  // NOT match here.
  const SIZE_TOKEN =
    /^(?:\d+[.,]?\d*[x×*]\d+[.,]?\d*|\d+[.,]?\d*(?:mm|cm|m|meter|inch|zoll|er)|\d+\/\d+["']?|m\d+)$/i;

  let firstSeen = false;
  return input.replace(re, (_m, prevTok: string, qty: string) => {
    // If the previous token is itself a size/dimensional value, we're
    // inside a product spec — don't split.
    if (SIZE_TOKEN.test(prevTok)) return `${prevTok} ${qty}`;

    // Skip the first qty in the sentence — it belongs to item #1.
    if (!firstSeen) {
      firstSeen = true;
      return `${prevTok} ${qty}`;
    }
    return `${prevTok}, ${qty}`;
  });
};

const splitSegments = (input: string): string[] => {
  // 1) Insert implicit commas around mid-sentence quantity tokens.
  const withCommas = insertImpliedCommas(input);

  // 2) Normalise explicit conjunctions to a comma.
  const normalized = withCommas
    .replace(/\s+(?:und|and|plus|sowie)\s+/gi, ", ")
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s+\/\s+/g, ", ")
    // Collapse duplicate commas (an explicit comma in the input may meet
    // an implicit one we just inserted, producing ", ,").
    .replace(/,\s*,/g, ",");

  // 3) Split on comma+whitespace only — keeps "3,5x35" intact.
  return normalized
    .split(/,\s+/)
    .map((s) =>
      s
        .trim()
        // Strip trailing punctuation / leftover conjunction tail so the
        // product phrase stays clean (e.g. "Schrauben," / "Hammer und").
        .replace(/[,;]+$/g, "")
        .replace(/\s+(?:und|and|plus|sowie)$/i, "")
        .trim(),
    )
    .filter((s) => s.length > 0);
};

/**
 * Pull the leading verb (if any) from the first segment so we can
 * re-prefix it onto subsequent verb-less segments. Returns the verb
 * string in its ORIGINAL casing or null.
 *
 * Walks token-by-token from the head: the first token whose REMOVAL
 * makes the remaining segment NOT parse as an order is the verb we
 * need to carry. This correctly skips over leading pronouns like
 * "I" / "ich" / "we" / "wir" — which the single-item parser strips
 * internally — and still finds the real verb ("need", "brauche").
 */
const extractLeadingVerb = (segment: string): string | null => {
  const firstIntent = parseVoiceOrder(segment);
  if (!firstIntent.isOrder) return null;

  const tokens = segment.split(/\s+/);
  // Try each prefix in turn: drop tokens 0..i, see if the tail still
  // looks like an order. The first `i` for which the tail is NO LONGER
  // an order means tokens[i] is the verb.
  for (let i = 0; i < Math.min(tokens.length - 1, 3); i++) {
    const tail = tokens.slice(i + 1).join(" ");
    if (!tail) return null;
    const tailIntent = parseVoiceOrder(tail);
    if (!tailIntent.isOrder) return tokens[i];
  }
  return null;
};

export function parseVoiceOrderMulti(input: string): MultiVoiceOrderResult {
  const raw = (input ?? "").trim();
  const fallback = parseVoiceOrder(raw);

  if (!raw) {
    return { isOrder: false, items: [], fallback };
  }

  const segments = splitSegments(raw);

  // Single segment → behave like the single-item parser.
  if (segments.length <= 1) {
    if (fallback.isOrder && fallback.productPhrase.length >= 2) {
      return {
        isOrder: true,
        items: [
          {
            quantity: fallback.quantity ?? 1,
            productPhrase: fallback.productPhrase,
            raw: fallback.raw,
          },
        ],
        fallback,
      };
    }
    return { isOrder: fallback.isOrder, items: [], fallback };
  }

  // Multi-segment path. The first segment must look like an order
  // (carries the verb). If it doesn't, this is not a multi-item voice
  // command — fall back to single-item handling on the whole input.
  if (!fallback.isOrder) {
    return { isOrder: false, items: [], fallback };
  }

  const carryVerb = extractLeadingVerb(segments[0]);
  const items: MultiVoiceOrderItem[] = [];

  segments.forEach((seg, idx) => {
    // Re-prefix verb on segments that don't already carry one so the
    // single-item parser flips into order mode.
    const segIntent = parseVoiceOrder(seg);
    let intent = segIntent;
    if ((!segIntent.isOrder || segIntent.productPhrase === seg) && carryVerb && idx > 0) {
      intent = parseVoiceOrder(`${carryVerb} ${seg}`);
    }

    if (!intent.isOrder) return;
    const phrase = intent.productPhrase.trim();
    if (phrase.length < 2) return;

    items.push({
      quantity: intent.quantity && intent.quantity > 0 ? intent.quantity : 1,
      productPhrase: phrase,
      raw: seg,
    });
  });

  if (items.length === 0) {
    return { isOrder: fallback.isOrder, items: [], fallback };
  }

  return { isOrder: true, items, fallback };
}
