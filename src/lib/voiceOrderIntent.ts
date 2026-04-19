/**
 * Voice-order intent parser.
 *
 * Goal: Take a freeform spoken phrase like
 *   "Order 50 screws 4x40"                        → qty 50, "screws 4x40"
 *   "Bestell 50 Schrauben 4x40"                   → qty 50, "Schrauben 4x40"
 *   "Add 10 gloves size M"                        → qty 10, "gloves size M"
 *   "Ich brauche 20 Dübel"                        → qty 20, "Dübel"
 *   "Put 5 WD-40 in cart"                         → qty 5,  "WD-40"
 *   "Verlängerungskabel 10 Meter zwei Stück kaufen" → qty 2, "Verlängerungskabel 10 Meter"
 *   "2 Stück Verlängerungskabel kaufen"           → qty 2, "Verlängerungskabel"
 *   "screws 4x40"                                 → not an order (plain search)
 *
 * Pure, sync, framework-free.
 */

export type VoiceOrderIntent = {
  isOrder: boolean;
  /** Quantity if extracted, else null (caller may default to 1). */
  quantity: number | null;
  /** Cleaned product search phrase. Empty when the utterance was only a verb. */
  productPhrase: string;
  /** The raw input, trimmed. */
  raw: string;
};

// Order-intent verbs / phrases. Lowercase, diacritic-stripped form.
const ORDER_VERBS = new Set([
  // English
  "order",
  "orders",
  "ordered",
  "add",
  "adds",
  "added",
  "need",
  "needs",
  "needed",
  "buy",
  "buys",
  "bought",
  "get",
  "gets",
  "got",
  "want",
  "wants",
  "wanted",
  "send",
  "sends",
  "purchase",
  // German
  "bestell",
  "bestelle",
  "bestellen",
  "bestellt",
  "fuge", // füge
  "fugen", // fügen
  "fuege",
  "fuegen",
  "hinzufuge",
  "hinzufugen",
  "hinzufuege",
  "hinzufuegen",
  "brauche",
  "brauchen",
  "braucht",
  "benoetige",
  "benotige",
  "benoetigen",
  "benotigen",
  "moechte",
  "mochte",
  "moechten",
  "mochten",
  "nimm",
  "nehme",
  "nehmen",
  "leg",
  "lege",
  "legen",
  "kauf",
  "kaufe",
  "kaufen",
  "kauft",
  "hol",
  "hole",
  "holen",
  "holt",
  "ordere",
  "ordern",
]);

// "put X in cart" / "in den warenkorb" patterns.
const ORDER_PHRASE_RE =
  /\b(put .+ (?:in(?:to)? (?:the )?cart|on (?:the )?(?:order|list)))\b|\b(in (?:den |meinen )?warenkorb)\b/;

// Trailing "in cart" / "in den warenkorb" / etc.
const TRAILING_FILLERS_RE =
  /\b(?:in(?:to)?|to|on)\s+(?:the\s+|den\s+|meinen\s+)?(?:cart|order|list|warenkorb|bestellung)\b/gi;

// Leading filler words (after verb removal).
const LEADING_FILLERS = new Set([
  "me",
  "a",
  "an",
  "the",
  "some",
  "please",
  "bitte",
  "ein",
  "eine",
  "einen",
  "ein paar",
  "paar",
  "mal",
  "noch",
  "auch",
  "doch",
  "hinzu",
  "ich",
  "wir",
  "mir",
  "uns",
]);

// Pre-strip leading subject pronouns BEFORE verb detection so
// "Ich brauche 20 Dübel" hits the "brauche" verb.
const LEADING_PRONOUNS = new Set(["ich", "wir", "mir", "uns", "i", "we"]);

// Unit/quantifier markers that should be stripped from the product phrase.
// When we see a number directly followed by one of these, the number is
// almost certainly the order quantity (e.g. "zwei Stück", "5 pcs").
const UNIT_MARKERS = new Set([
  "stk",
  "stueck", // stück (NFD)
  "stuck",
  "stck",
  "stk.",
  "pcs",
  "pc",
  "pieces",
  "piece",
  "x",
  "mal",
]);

// German number words 1-12.
// German number words 1-12. Keys are stored in BOTH the diacritic-stripped
// form (matches Web Speech output after our NFD strip — "fünf" → "funf")
// AND the ASCII transliteration ("fuenf") so either spelling resolves.
const GERMAN_NUMBERS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  funf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwolf: 12,
  zwoelf: 12,
};
const ENGLISH_NUMBERS: Record<string, number> = {
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
};

// Multipliers — handle "tausend", "hundert", "thousand", "hundred", "k".
const MULTIPLIERS: Record<string, number> = {
  hundert: 100,
  hundred: 100,
  tausend: 1000,
  thousand: 1000,
  k: 1000,
  mio: 1_000_000,
  million: 1_000_000,
  millionen: 1_000_000,
};

/**
 * Normalize digit groups like "1.000", "1,000", "10.000" into "1000",
 * "10000". Web Speech (de-DE) often returns large numbers with a thousands
 * separator that breaks plain integer parsing.
 *
 * Rule: a separator (. or ,) between digits where the trailing group is
 * exactly 3 digits AND not followed by another digit-group-of-3-or-more
 * is treated as a thousands separator.
 *   "1.000"   → "1000"
 *   "10.000"  → "10000"
 *   "1.000.000" → "1000000"
 *   "3,5x35"  → unchanged (decimal, not thousands)
 *   "4,5"     → unchanged (single trailing digit group, not 3)
 */
const normalizeThousands = (input: string): string => {
  // Repeatedly collapse "<digits><sep><exactly 3 digits>" boundaries.
  let prev: string;
  let out = input;
  do {
    prev = out;
    out = out.replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2");
  } while (out !== prev);
  return out;
};

/**
 * Collapse spoken composites like "zwei tausend", "five hundred",
 * "drei hundert fünfzig" → a single digit token.
 *
 * Strategy: walk tokens, whenever we see <number-word> followed by
 * <multiplier-word> (or just a multiplier alone) compute the product
 * and emit it as a digit token. Adjacent additive numbers ("hundert
 * fünfzig" → 150) are also folded.
 */
const collapseSpokenNumbers = (rawTokens: string[], matchTokens: string[]): {
  raw: string[];
  match: string[];
} => {
  const r: string[] = [];
  const m: string[] = [];

  const tokenAsNumber = (lower: string): number | null => {
    if (/^\d+$/.test(lower)) return parseInt(lower, 10);
    if (lower in GERMAN_NUMBERS) return GERMAN_NUMBERS[lower];
    if (lower in ENGLISH_NUMBERS) return ENGLISH_NUMBERS[lower];
    return null;
  };

  let i = 0;
  while (i < matchTokens.length) {
    const cur = matchTokens[i];
    const curNum = tokenAsNumber(cur);
    const next = matchTokens[i + 1];
    const nextMult = next && next in MULTIPLIERS ? MULTIPLIERS[next] : null;

    // <number> <multiplier>  → number * multiplier
    if (curNum !== null && nextMult !== null) {
      let total = curNum * nextMult;
      let consumed = 2;
      // Try to absorb a trailing additive: "<n> tausend <m>" → total + m
      const after = matchTokens[i + 2];
      const afterNum = after ? tokenAsNumber(after) : null;
      if (afterNum !== null && afterNum < nextMult) {
        total += afterNum;
        consumed = 3;
      }
      r.push(String(total));
      m.push(String(total));
      i += consumed;
      continue;
    }

    // Bare multiplier ("tausend Schrauben") → 1 * multiplier
    if (cur in MULTIPLIERS) {
      r.push(String(MULTIPLIERS[cur]));
      m.push(String(MULTIPLIERS[cur]));
      i += 1;
      continue;
    }

    r.push(rawTokens[i]);
    m.push(matchTokens[i]);
    i += 1;
  }

  return { raw: r, match: m };
};

const stripDiacritics = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");

/**
 * Spec/size token: 4x40, 3,5x35, M8, 12mm, 1/2", 10m, 10er.
 * Importantly this catches "10m" AND any pure-spec form so dimensional
 * numbers don't get misread as the order quantity.
 */
const SIZE_TOKEN_RE =
  /^(?:\d+[.,]?\d*\s*[x×*]\s*\d+|m\d+|\d+[.,]?\d*\s*(?:mm|cm|m|meter|metre|inch|zoll|er|"|'')|\d+\/\d+["']?)$/i;

const isSizeToken = (t: string) => SIZE_TOKEN_RE.test(t);

/** Returns true if the token (lowercased, diacritic-stripped) is an order verb. */
const isVerb = (t: string) => ORDER_VERBS.has(t);

/**
 * Find the first quantity in the token list, returning {value, index}.
 * Skips size tokens like "4x40", "10m", "12mm".
 *
 * BIAS: if a numeric token is immediately followed by a UNIT_MARKER (e.g.
 * "2 Stück", "5 pcs"), prefer that one — it's almost certainly the order qty.
 */
const findQuantity = (tokens: string[]): { value: number; index: number } | null => {
  // First pass: number followed by unit marker.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isSizeToken(t)) continue;
    const next = tokens[i + 1]?.toLowerCase();
    if (!next || !UNIT_MARKERS.has(next)) continue;

    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n > 0 && n <= 100000) return { value: n, index: i };
    }
    const lower = t.toLowerCase();
    if (lower in GERMAN_NUMBERS) return { value: GERMAN_NUMBERS[lower], index: i };
    if (lower in ENGLISH_NUMBERS) return { value: ENGLISH_NUMBERS[lower], index: i };
  }

  // Second pass: first plausible standalone number.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isSizeToken(t)) continue;

    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n) && n > 0 && n <= 100000) return { value: n, index: i };
    }
    const lower = t.toLowerCase();
    if (lower in GERMAN_NUMBERS) return { value: GERMAN_NUMBERS[lower], index: i };
    if (lower in ENGLISH_NUMBERS) return { value: ENGLISH_NUMBERS[lower], index: i };
  }
  return null;
};

const trimLeadingFillers = (tokens: string[]): string[] => {
  let out = [...tokens];
  let changed = true;
  while (changed && out.length > 0) {
    changed = false;
    const head = out[0].toLowerCase();
    if (LEADING_FILLERS.has(head)) {
      out = out.slice(1);
      changed = true;
    }
  }
  return out;
};

const trimTrailingFillers = (tokens: string[]): string[] => {
  let out = [...tokens];
  while (out.length > 0) {
    const tail = out[out.length - 1].toLowerCase();
    if (
      tail === "hinzu" ||
      tail === "please" ||
      tail === "bitte" ||
      tail === "danke" ||
      tail === "thanks" ||
      UNIT_MARKERS.has(tail)
    ) {
      out = out.slice(0, -1);
    } else break;
  }
  return out;
};

/**
 * Strip ALL verb tokens and ALL unit-marker tokens from anywhere in the
 * stream. Keeps a parallel raw-token array in sync so the output preserves
 * original casing (e.g. "WD-40", "Schrauben").
 */
const stripVerbsAndUnits = (
  matchTokens: string[],
  rawTokens: string[],
): { m: string[]; r: string[] } => {
  const m: string[] = [];
  const r: string[] = [];
  for (let i = 0; i < matchTokens.length; i++) {
    const t = matchTokens[i];
    if (isVerb(t)) continue;
    if (UNIT_MARKERS.has(t)) continue;
    m.push(t);
    r.push(rawTokens[i]);
  }
  return { m, r };
};

export function parseVoiceOrder(input: string): VoiceOrderIntent {
  const raw = (input ?? "").trim();
  if (!raw) {
    return { isOrder: false, quantity: null, productPhrase: "", raw: "" };
  }

  // Normalize spoken/locale-formatted numbers BEFORE tokenization:
  // "1.000" / "1,000" → "1000". This must run on the raw and cleaned
  // strings together so token positions stay aligned.
  const rawNormalized = normalizeThousands(raw);
  const cleanedForMatch = stripDiacritics(rawNormalized.toLowerCase());
  const withoutCartPhrase = cleanedForMatch.replace(TRAILING_FILLERS_RE, " ");

  const matchTokensFull = withoutCartPhrase.split(/\s+/).filter(Boolean);
  const rawTokensFull = rawNormalized
    .replace(TRAILING_FILLERS_RE, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Pre-strip leading subject pronouns ("ich", "wir", "i", "we") so the
  // verb detection sees the actual verb next.
  let matchTokens = [...matchTokensFull];
  let rawTokens = [...rawTokensFull];
  while (matchTokens.length > 0 && LEADING_PRONOUNS.has(matchTokens[0])) {
    matchTokens = matchTokens.slice(1);
    rawTokens = rawTokens.slice(1);
  }

  // Detect intent: any verb token anywhere, OR a known multi-word phrase.
  const verbAnywhere = matchTokens.some(isVerb);
  const phraseMatch = ORDER_PHRASE_RE.test(cleanedForMatch);
  const isOrder = verbAnywhere || phraseMatch;

  if (!isOrder) {
    return { isOrder: false, quantity: null, productPhrase: raw, raw };
  }

  // Drop any leading "put" (covered by phrase match, not a verb).
  if (matchTokens[0] === "put") {
    matchTokens = matchTokens.slice(1);
    rawTokens = rawTokens.slice(1);
  }

  // Collapse spoken composites BEFORE quantity extraction so
  // "zwei tausend Schrauben" → "2000 Schrauben" → qty 2000.
  const collapsed = collapseSpokenNumbers(rawTokens, matchTokens);
  matchTokens = collapsed.match;
  rawTokens = collapsed.raw;

  // Quantity extraction (uses the still-verb-bearing stream so unit-marker
  // bias works across positions).
  const q = findQuantity(matchTokens);
  let quantity: number | null = null;
  if (q) {
    quantity = q.value;
    matchTokens.splice(q.index, 1);
    rawTokens.splice(q.index, 1);
  }

  // Strip verbs + unit markers from anywhere.
  const { m, r } = stripVerbsAndUnits(matchTokens, rawTokens);

  // Trim leading + trailing filler.
  const afterLead = trimLeadingFillers(m);
  const droppedLead = m.length - afterLead.length;
  let phraseTokens = r.slice(droppedLead);

  const afterTail = trimTrailingFillers(afterLead);
  const droppedTail = afterLead.length - afterTail.length;
  if (droppedTail > 0) phraseTokens = phraseTokens.slice(0, phraseTokens.length - droppedTail);

  const productPhrase = phraseTokens.join(" ").trim();

  return { isOrder: true, quantity, productPhrase, raw };
}
