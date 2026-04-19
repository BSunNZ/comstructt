/**
 * Material classifier — splits a freeform search query into:
 *   - "A_B"     → high-value / planned procurement materials
 *                 (must be ordered via the procurement system, NOT here)
 *   - "C"       → consumable / small parts (this app's primary use case)
 *   - "unknown" → no keyword match, behave normally
 *
 * Matching is case-insensitive AND diacritic-insensitive (ä/ö/ü/ß), and
 * works on substrings so "stahlträger 200" still matches "stahlträger".
 *
 * Pure, sync, framework-free.
 */

export type MaterialClass = "A_B" | "C" | "unknown";

// A & B materials — show the warning, disable Add buttons.
export const A_B_KEYWORDS: ReadonlyArray<string> = [
  // Tragwerk & Stahlbau
  "stahlträger", "stahlstütze", "stahlprofil", "walzprofil", "konstruktionsstahl",
  "hea-träger", "heb-träger", "ipe-träger", "upn-profil", "doppel-t-träger",
  "i-träger", "stahlriegel", "verbunddecke", "stahlbau", "tragwerk", "stütze", "träger",
  // Betonbau & Fundamente
  "bewehrungsstahl", "betonstahl", "armierungsstahl", "stahlbeton", "bewehrung",
  "bewehrungsmatte", "betonstahlmatte", "ortbeton", "transportbeton", "spannbeton",
  "spannbetonträger", "betonfertigteil", "fertigteil", "fundament", "bohrpfahl",
  "fundamentplatte", "bodenplatte", "streifenfundament",
  // Mauerwerk & Rohbaustoffe
  "mauerwerk", "ziegel", "mauerziegel", "backstein", "kalksandstein",
  "porenbetonstein", "ytong", "leichtbeton", "klinker", "stahlbetonwand",
  "betonwand", "betondecke", "schalung", "schalungssystem", "zement", "trasszement",
  "beton", "kies", "schotter", "sand",
  // Großgeräte
  "kran", "turmdrehkran", "autokran", "bagger", "raupenbagger", "betonpumpe",
  "betonmischfahrzeug", "baumaschine", "walze", "planierraupe", "baukran",
  "gerüstsystem", "gerüst",
  // TGA Heizung/Lüftung/Sanitär
  "heizungsanlage", "heizkörper", "flächenheizung", "fußbodenheizung", "wärmepumpe",
  "fernwärmeanschluss", "lüftungsanlage", "klimaanlage", "lüftungskanal",
  "sanitäranlage", "sanitärinstallation", "rohrleitung", "abwasserleitung",
  "wasserleitung", "druckrohr", "kälteanlage", "sprinkleranlage", "brandmeldeanlage",
  // TGA Elektro & Automation
  "elektroinstallation", "elektroverteiler", "schaltschrank", "kabeltrasse",
  "netzanschluss", "trafoanschluss", "stromschiene", "blitzschutzanlage",
  "erdungsanlage", "photovoltaikanlage", "aufzugsanlage", "förderanlage",
  "gebäudeautomation", "msr-technik",
  // Hülle & Ausbau
  "fassade", "fassadensystem", "fassadenplatte", "vorhangfassade", "fenster",
  "fensterelement", "pfosten-riegel-fassade", "türanlage", "außentür",
  "brandschutztür", "schiebetor", "dachkonstruktion", "dachstuhl", "dacheindeckung",
  "dachziegel", "abdichtungsbahn", "bitumenbahn",
  // Dämmung & Tiefbau
  "wärmedämmung", "dämmung", "mineralwolle", "glaswolle", "steinwolle",
  "eps-dämmung", "xps-dämmung", "holzbau", "holzrahmen", "brettsperrholz",
  "estrich", "rohbau", "tiefbau", "kanalisation", "drainagerohr", "bitumen",
];

// C materials — show a subtle confirmation badge.
export const C_KEYWORDS: ReadonlyArray<string> = [
  "arbeitshandschuhe", "schutzhandschuhe", "handschuhe", "sicherheitsschuhe",
  "schutzbrille", "warnweste", "helm", "schutzhelm", "gehörschutz", "atemschutz",
  "schutzausrüstung", "psa", "schrauben", "nägel", "dübel", "bolzen", "muttern",
  "klebeband", "abdichtband", "klebstoff", "silikon", "bauschaum", "pu-schaum",
  "schleifpapier", "schleifscheibe", "trennscheibe", "bohrer", "reinigungsmittel",
  "lösungsmittel", "rostschutz", "schmierstoff", "spray", "markierfarbe",
  "abdeckplane", "schutzfolie", "malerkrepp", "kabelbinder", "akkus", "batterien",
  "leuchtmittel", "mülltüten", "besen", "eimer", "binddraht", "spanngurt",
  "fugenmasse", "fliesenkleber", "grundierung", "tiefengrund", "erste-hilfe",
];

/**
 * Normalize for matching: lowercase + strip diacritics + collapse ß→ss.
 * "Stahlträger" → "stahltrager". "Mörtel" → "mortel". This way users typing
 * with or without umlauts both hit the same keywords.
 */
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .trim();

const NORMALIZED_A_B: ReadonlyArray<string> = A_B_KEYWORDS.map(normalize);
const NORMALIZED_C: ReadonlyArray<string> = C_KEYWORDS.map(normalize);

const MIN_QUERY_LEN = 3;

/**
 * Classify a query. Returns "unknown" for queries shorter than 3 chars so
 * the caller doesn't have to special-case it.
 *
 * A_B takes precedence over C — if a phrase mentions both (rare), the
 * planned-procurement warning wins because the consequence of a wrong
 * order is much higher.
 */
export function classifyMaterial(query: string): MaterialClass {
  const q = normalize(query ?? "");
  if (q.length < MIN_QUERY_LEN) return "unknown";

  for (const kw of NORMALIZED_A_B) {
    if (q.includes(kw)) return "A_B";
  }
  for (const kw of NORMALIZED_C) {
    if (q.includes(kw)) return "C";
  }
  return "unknown";
}
