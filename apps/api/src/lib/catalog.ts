import OpenAI from "openai";

const openai = new OpenAI();

import {
  CATALOG_STATUSES,
  DEFAULT_DERIVED_FIELD_MAPPINGS,
  DERIVED_FIELD_TARGETS,
  CSV_IMPORT_TARGETS,
  NORMALIZED_CATEGORIES,
  type CatalogStatus,
  type DerivedFieldMapping,
  type CsvImportFieldTarget,
  type CsvImportMapping,
  type ImportPreviewRow,
  type NormalizedCategory,
  type ProductVariantAttribute,
} from "@comstruct/shared";

export const REQUIRED_SAMPLE_COLUMNS = [
  "artikel_id",
  "artikelname",
  "kategorie",
  "einheit",
  "preis_eur",
  "lieferant",
  "verbrauchsart",
  "gefahrgut",
  "lagerort",
  "typische_baustelle"
] as const;

type RawCsvRow = Record<string, string>;

const DEFAULT_AI_SUBCATEGORIES = [
  "Befestigung - Schrauben",
  "Befestigung - Dübel und Anker",
  "Befestigung - Muttern und Unterlegscheiben",
  "Befestigung - Nägel",
  "Befestigung - Kabelbinder",
  "Elektro - Kabel und Leitungen",
  "Elektro - Isolierung und Isolierband",
  "Elektro - Stromverteilung",
  "Elektro - Baustellenbeleuchtung",
  "Elektro - Kabelführung",
  "PSA - Handschutz",
  "PSA - Augenschutz",
  "PSA - Gehörschutz",
  "PSA - Atemschutz",
  "PSA - Kopfschutz",
  "PSA - Warnschutz und Arbeitskleidung",
  "Dichtstoffe - Silikon und Acryl",
  "Dichtstoffe - PU-Schaum",
  "Klebstoffe und Klebebänder",
  "Abdeckung und Schutz",
  "Folien und Abdichtung",
  "Farben und Beschichtungen",
  "Markierung und Anreißen",
  "Reinigung",
  "Chemie und Wartung",
  "Entsorgung",
  "Handwerkzeuge",
  "Zubehör für Elektrowerkzeuge",
  "Schneiden und Trennen",
  "Bohren und Bits",
  "Messen und Ausrichten",
  "Malerbedarf",
  "Trockenbauzubehör",
  "Fliesenzubehör",
  "Mauerwerk und Betonzubehör",
  "Eimer und Behälter",
  "Transport und Ladungssicherung",
  "Verpackung und Schutz",
  "Baustellen-Schreibwaren",
  "Allgemeiner Baustellenbedarf",
  "Sonstiges",
] as const;

type ProductEnrichment = {
  category: NormalizedCategory;
  subcategory: string;
  typicalSite: string;
  consumptionType: "Consumable" | "Asset/Tool";
  isHazmat: boolean;
  storageLocation: string;
};

export interface NormalizedProductIdentity {
  normalizedName: string;
  familyName: string;
  familyKey: string;
  variantLabel: string;
  variantAttributes: ProductVariantAttribute[];
}

type ProductIdentityOverrides = {
  familyName?: string;
  variantLabel?: string;
};

const COLOR_VARIANTS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /transparent/gi, value: "transparent" },
  { pattern: /klar/gi, value: "klar" },
  { pattern: /wei(?:ss|ß)/gi, value: "weiß" },
  { pattern: /schwarz/gi, value: "schwarz" },
  { pattern: /rot/gi, value: "rot" },
  { pattern: /blau/gi, value: "blau" },
  { pattern: /gr(?:u|ü)n/gi, value: "grün" },
  { pattern: /gelb/gi, value: "gelb" },
  { pattern: /orange/gi, value: "orange" },
  { pattern: /silber/gi, value: "silber" },
  { pattern: /grau/gi, value: "grau" },
];

const SIZE_CLASS_VARIANTS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /klein/gi, value: "klein" },
  { pattern: /gro(?:ss|ß)/gi, value: "groß" },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string): string {
  return normalizeWhitespace(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
  );
}

function formatMatchedValue(raw: string): string {
  return normalizeWhitespace(
    raw
      .replace(/[xX]/g, "x")
      .replace(/\bgr\.?\s*/gi, "Gr. ")
      .replace(/\btx\s*/gi, "TX")
      .replace(/\bffp\s*/gi, "FFP")
      .replace(/\bl\b/g, "L")
  );
}

function pushVariantAttribute(
  attributes: ProductVariantAttribute[],
  key: string,
  value: string
) {
  if (!value) {
    return;
  }

  const normalizedValue = normalizeWhitespace(value);
  if (!normalizedValue) {
    return;
  }

  if (attributes.some((attribute) => attribute.key === key && attribute.value === normalizedValue)) {
    return;
  }

  attributes.push({ key, value: normalizedValue });
}

function removePattern(
  workingName: string,
  pattern: RegExp,
  key: string,
  attributes: ProductVariantAttribute[],
  formatValue: (raw: string) => string = formatMatchedValue
): string {
  const matches = Array.from(workingName.matchAll(pattern));

  for (const match of matches) {
    pushVariantAttribute(attributes, key, formatValue(match[0]));
  }

  return normalizeWhitespace(workingName.replace(pattern, " "));
}

function buildVariantLabel(attributes: ProductVariantAttribute[]): string {
  return attributes.map((attribute) => attribute.value).join(" / ");
}

export function normalizeProductIdentity(
  sourceName: string,
  overrides?: ProductIdentityOverrides
): NormalizedProductIdentity {
  const originalName = normalizeWhitespace(sourceName);
  let workingName = originalName;
  let variantAttributes: ProductVariantAttribute[] = [];

  workingName = removePattern(
    workingName,
    /\b\d+(?:[.,]\d+)?\s?[xX]\s?\d+(?:[.,]\d+)?\s?(?:mm|cm|m|L)?\b/gi,
    "dimension",
    variantAttributes
  );
  workingName = removePattern(workingName, /\bTX\s?\d+\b/gi, "drive", variantAttributes);
  workingName = removePattern(workingName, /\bM\d+\b/gi, "metric", variantAttributes);
  workingName = removePattern(workingName, /\bGr\.?\s?\d+\b/gi, "size", variantAttributes);
  workingName = removePattern(workingName, /\bFFP\s?\d+\b/gi, "class", variantAttributes);
  workingName = removePattern(workingName, /\b\d+(?:[.,]\d+)?\s?mm\b/gi, "size", variantAttributes);
  workingName = removePattern(workingName, /\b\d+(?:[.,]\d+)?\s?cm\b/gi, "size", variantAttributes);
  workingName = removePattern(workingName, /\b\d+(?:[.,]\d+)?\s?m\b/gi, "size", variantAttributes);
  workingName = removePattern(workingName, /\b\d+(?:[.,]\d+)?\s?L\b/gi, "size", variantAttributes);

  if (/schleifpapier/i.test(workingName)) {
    workingName = removePattern(
      workingName,
      /\b\d{2,3}\b/gi,
      "grit",
      variantAttributes,
      (raw) => raw.trim()
    );
  }

  for (const colorVariant of COLOR_VARIANTS) {
    workingName = removePattern(
      workingName,
      colorVariant.pattern,
      "color",
      variantAttributes,
      () => colorVariant.value
    );
  }

  for (const sizeClassVariant of SIZE_CLASS_VARIANTS) {
    workingName = removePattern(
      workingName,
      sizeClassVariant.pattern,
      "sizeClass",
      variantAttributes,
      () => sizeClassVariant.value
    );
  }

  const parsedFamilyName = normalizeWhitespace(
    workingName
      .replace(/\s+[-/]\s+/g, " ")
      .replace(/^[,;/.-]+|[,;/.-]+$/g, "")
  ) || originalName;
  const parsedVariantLabel = buildVariantLabel(variantAttributes);
  const familyName = normalizeWhitespace(overrides?.familyName ?? parsedFamilyName) || originalName;
  const variantLabel = normalizeWhitespace(overrides?.variantLabel ?? parsedVariantLabel);

  if (overrides?.variantLabel !== undefined && variantLabel !== parsedVariantLabel) {
    variantAttributes = variantLabel ? [{ key: "manual", value: variantLabel }] : [];
  }

  const normalizedName = variantLabel ? `${familyName} ${variantLabel}` : familyName;

  return {
    normalizedName,
    familyName,
    familyKey: normalizeComparable(familyName),
    variantLabel,
    variantAttributes,
  };
}

export function buildDefaultMapping(columns: string[]): CsvImportMapping[] {
  const targetByColumn = new Map<string, CsvImportFieldTarget>([
    ["artikel_id", "supplierSku"],
    ["artikelname", "sourceName"],
    ["kategorie", "sourceCategory"],
    ["family_name", "familyName"],
    ["produktfamilie", "familyName"],
    ["variant", "variantLabel"],
    ["variant_label", "variantLabel"],
    ["einheit", "unit"],
    ["preis_eur", "unitPrice"],
    ["lieferant", "supplierName"],
    ["verbrauchsart", "consumptionType"],
    ["gefahrgut", "hazardous"],
    ["lagerort", "storageLocation"],
    ["typische_baustelle", "typicalSite"],
    ["supplier_sku", "supplierSku"],
    ["source_name", "sourceName"],
    ["source_category", "sourceCategory"],
    ["category", "normalizedCategory"],
    ["subcategory", "subcategory"],
    ["contract_price", "unitPrice"],
    ["supplier_name", "supplierName"],
    ["consumption_type", "consumptionType"],
    ["storage_location", "storageLocation"],
    ["typical_site", "typicalSite"],
    ["catalog_status", "catalogStatus"],
    ["is_c_material", "isCMaterial"],
  ]);

  return columns.map((sourceColumn) => ({
    sourceColumn,
    target: targetByColumn.get(sourceColumn) ?? "ignore"
  }));
}

export function validateColumns(columns: string[]): string[] {
  return REQUIRED_SAMPLE_COLUMNS.filter((column) => !columns.includes(column));
}

export function validateMapping(mapping: CsvImportMapping[], columns: string[]): string[] {
  const errors: string[] = [];

  for (const sourceColumn of columns) {
    if (!mapping.some((entry) => entry.sourceColumn === sourceColumn)) {
      errors.push(`Missing mapping for column "${sourceColumn}".`);
    }
  }

  for (const target of ["supplierSku", "sourceName", "sourceCategory", "unit", "unitPrice", "supplierName"] as const) {
    const matches = mapping.filter((entry) => entry.target === target);
    if (matches.length !== 1) {
      errors.push(`Target "${target}" must be mapped exactly once.`);
    }
  }

  return errors;
}

export function sanitizeIncomingMapping(
  columns: string[],
  mapping?: CsvImportMapping[]
): CsvImportMapping[] {
  if (!mapping || mapping.length === 0) {
    return buildDefaultMapping(columns);
  }

  const validTargets = new Set<string>([...CSV_IMPORT_TARGETS, "ignore"]);
  const sanitized = columns.map((column) => {
    const incoming = mapping.find((entry) => entry.sourceColumn === column);

    return {
      sourceColumn: column,
      target:
        incoming && validTargets.has(incoming.target)
          ? incoming.target
          : "ignore"
    } satisfies CsvImportMapping;
  });

  return sanitized;
}

export function sanitizeIncomingDerivedMapping(
  mapping?: DerivedFieldMapping[]
): DerivedFieldMapping[] {
  if (!mapping || mapping.length === 0) {
    return DEFAULT_DERIVED_FIELD_MAPPINGS.map((entry) => ({ ...entry }));
  }

  return DEFAULT_DERIVED_FIELD_MAPPINGS.map((defaultEntry) => {
    const incoming = mapping.find((entry) => entry.field === defaultEntry.field);
    const validTargets = DERIVED_FIELD_TARGETS[defaultEntry.field];

    return {
      field: defaultEntry.field,
      target:
        incoming && validTargets.includes(incoming.target as never)
          ? incoming.target
          : defaultEntry.target,
    };
  });
}

export function normalizeBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function normalizePrice(value: string): number {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid price "${value}".`);
  }

  return parsed;
}

export function normalizeCategory(value: string, productName = ""): NormalizedCategory {
  const lower = normalizeComparable(value);
  const productLower = normalizeComparable(productName);
  const haystack = `${lower} ${productLower}`.trim();

  if (!haystack) {
    return "Other";
  }

  if (
    haystack.includes("fasteners") ||
    haystack.includes("befestigung") ||
    haystack.includes("kunststoff") ||
    haystack.includes("dubel") ||
    haystack.includes("schraube") ||
    haystack.includes("mutter") ||
    haystack.includes("nagel") ||
    haystack.includes("unterlegscheibe") ||
    haystack.includes("kabelbinder") ||
    haystack.includes("fliesenkreuze")
  ) {
    return "Fasteners";
  }

  if (
    haystack.includes("electrical") ||
    haystack.includes("elektro") ||
    haystack.includes("kabel") ||
    haystack.includes("draht") ||
    haystack.includes("lampe") ||
    haystack.includes("steckdose") ||
    haystack.includes("kabeltrommel")
  ) {
    return "Electrical";
  }

  if (
    haystack.includes("ppe") ||
    haystack.includes("psa") ||
    haystack.includes("schutz") ||
    haystack.includes("handschuh") ||
    haystack.includes("helm") ||
    haystack.includes("weste") ||
    haystack.includes("maske") ||
    haystack.includes("kniepolster")
  ) {
    return "PPE";
  }

  if (
    haystack.includes("consumables") ||
    haystack.includes("chemie") ||
    haystack.includes("dichtstoff") ||
    haystack.includes("abdichtung") ||
    haystack.includes("abdeckung") ||
    haystack.includes("klebeband") ||
    haystack.includes("farbe") ||
    haystack.includes("markierung") ||
    haystack.includes("markierspray") ||
    haystack.includes("reinigung") ||
    haystack.includes("entsorgung") ||
    haystack.includes("verpackung") ||
    haystack.includes("verbrauch") ||
    haystack.includes("konsum") ||
    haystack.includes("vlies") ||
    haystack.includes("folie") ||
    haystack.includes("silikon") ||
    haystack.includes("acryl") ||
    haystack.includes("schaum") ||
    haystack.includes("alkohol") ||
    haystack.includes("spray") ||
    haystack.includes("fett") ||
    haystack.includes("rostloser") ||
    haystack.includes("wd 40") ||
    haystack.includes("putztuch") ||
    haystack.includes("mullsack")
  ) {
    return "Consumables";
  }

  if (
    haystack.includes("tools") ||
    haystack.includes("werkzeug") ||
    haystack.includes("handwerkzeug") ||
    haystack.includes("messwerkzeug") ||
    haystack.includes("malerbedarf") ||
    haystack.includes("spachtel") ||
    haystack.includes("kelle") ||
    haystack.includes("wasserwaage") ||
    haystack.includes("zollstock") ||
    haystack.includes("bohrer") ||
    haystack.includes("bit ") ||
    haystack.includes("gummihammer") ||
    haystack.includes("richtlatte") ||
    haystack.includes("lineal") ||
    haystack.includes("roller") ||
    haystack.includes("pinsel") ||
    haystack.includes("mischstab")
  ) {
    return "Tools";
  }

  if (
    haystack.includes("site supplies") ||
    haystack.includes("baustelle") ||
    haystack.includes("site") ||
    haystack.includes("behalter") ||
    haystack.includes("transport") ||
    haystack.includes("schreibwaren") ||
    haystack.includes("kleinmaterial") ||
    haystack.includes("planenhaken") ||
    haystack.includes("eimer") ||
    haystack.includes("spanngurt") ||
    haystack.includes("marker") ||
    haystack.includes("besen") ||
    haystack.includes("handfeger") ||
    haystack.includes("kehrschaufel")
  ) {
    return "Site Supplies";
  }

  return "Other";
}

export function normalizeCatalogStatus(value: string): CatalogStatus {
  const lower = normalizeComparable(value);

  if (!lower) {
    return "imported";
  }

  if (["published", "approved", "live", "active"].includes(lower)) {
    return "published";
  }

  if (["excluded", "blocked", "ignore", "inactive"].includes(lower)) {
    return "excluded";
  }

  return "imported";
}

export function assertNormalizedCategory(value: string): NormalizedCategory {
  if (NORMALIZED_CATEGORIES.includes(value as NormalizedCategory)) {
    return value as NormalizedCategory;
  }

  throw new Error(`Unsupported category "${value}".`);
}

export function assertCatalogStatus(value: string): CatalogStatus {
  if (CATALOG_STATUSES.includes(value as CatalogStatus)) {
    return value as CatalogStatus;
  }

  throw new Error(`Unsupported catalog status "${value}".`);
}

export function buildPreviewRow(
  row: RawCsvRow,
  mapping: CsvImportMapping[]
): ImportPreviewRow {
  const valueByTarget = new Map<CsvImportFieldTarget, string>();

  for (const entry of mapping) {
    if (entry.target === "ignore") {
      continue;
    }

    valueByTarget.set(entry.target, row[entry.sourceColumn] ?? "");
  }

  const sourceName = valueByTarget.get("sourceName")?.trim() ?? "";
  const sourceCategory = valueByTarget.get("sourceCategory")?.trim() ?? "";
  const mappedFamilyName = valueByTarget.get("familyName")?.trim();
  const mappedVariantLabel = valueByTarget.get("variantLabel")?.trim();
  const identity = normalizeProductIdentity(sourceName, {
    familyName: mappedFamilyName || undefined,
    variantLabel: mappedVariantLabel || undefined,
  });
  const mappedNormalizedCategory = valueByTarget.get("normalizedCategory")?.trim() ?? "";
  const normalizedCategory = mappedNormalizedCategory
    ? normalizeCategory(mappedNormalizedCategory, sourceName)
    : normalizeCategory(sourceCategory, sourceName);
  const mappedSubcategory = valueByTarget.get("subcategory")?.trim() ?? "";
  const subcategory = mappedSubcategory || sourceCategory;
  const catalogStatus = normalizeCatalogStatus(valueByTarget.get("catalogStatus") ?? "");
  const isCMaterialValue = valueByTarget.get("isCMaterial");

  return {
    supplierName: valueByTarget.get("supplierName")?.trim() ?? "",
    supplierSku: valueByTarget.get("supplierSku")?.trim() ?? "",
    sourceName,
    normalizedName: identity.normalizedName,
    familyName: identity.familyName,
    variantLabel: identity.variantLabel,
    variantAttributes: identity.variantAttributes,
    sourceCategory,
    normalizedCategory,
    subcategory,
    unit: valueByTarget.get("unit")?.trim() ?? "",
    unitPrice: normalizePrice(valueByTarget.get("unitPrice") ?? "0"),
    consumptionType: valueByTarget.get("consumptionType")?.trim() ?? "",
    hazardous: normalizeBoolean(valueByTarget.get("hazardous") ?? "false"),
    storageLocation: valueByTarget.get("storageLocation")?.trim() ?? "",
    typicalSite: valueByTarget.get("typicalSite")?.trim() ?? "",
    catalogStatus,
    isCMaterial:
      isCMaterialValue !== undefined ? normalizeBoolean(isCMaterialValue) : true,
  };
}

export function summarizeImport(
  rows: ImportPreviewRow[]
): Pick<ImportPreviewRow, "supplierName" | "sourceCategory">[] {
  return rows;
}

export function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, String(value ?? "")])
  );
}

function parseAllowedSubcategories(customCategories?: string): string[] {
  const parsed = (customCategories ?? "")
    .split(/[\r\n,;|]+/g)
    .map((value) => value.replace(/^\s*[-*•]\s*/, "").replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    return [...DEFAULT_AI_SUBCATEGORIES];
  }

  return parsed.filter(
    (value, index) =>
      parsed.findIndex(
        (candidate) => candidate.localeCompare(value, undefined, { sensitivity: "accent" }) === 0
      ) === index
  );
}

function scoreEnumMatch(input: string, candidate: string): number {
  const normalizedInput = normalizeComparable(input);
  const normalizedCandidate = normalizeComparable(candidate);

  if (!normalizedInput || !normalizedCandidate) {
    return 0;
  }

  if (normalizedInput === normalizedCandidate) {
    return 10_000;
  }

  if (normalizedInput.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedInput)) {
    return 5_000;
  }

  const inputTokens = new Set(normalizedInput.split(" ").filter(Boolean));
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  let overlap = 0;

  for (const token of candidateTokens) {
    if (inputTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function pickFallbackSubcategory(
  productName: string,
  rawCategory: string,
  allowedSubcategories: string[]
): string {
  const combinedInput = `${rawCategory} ${productName}`.trim();
  let bestMatch = allowedSubcategories[0] ?? "General";
  let bestScore = -1;

  for (const candidate of allowedSubcategories) {
    const score = scoreEnumMatch(combinedInput, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

export async function enrichProductRowWithLLM(
  productName: string,
  rawCategory: string,
  customCategories?: string
): Promise<ProductEnrichment> {
  const allowedSubcategories = parseAllowedSubcategories(customCategories);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4-mini-2026-03-17",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "procurement_product_enrichment",
          strict: true,
          schema: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: [...NORMALIZED_CATEGORIES],
              },
              subcategory: {
                type: "string",
                enum: allowedSubcategories,
              },
              consumptionType: {
                type: "string",
                enum: ["Consumable", "Asset/Tool"],
              },
              isHazmat: {
                type: "boolean",
              },
              storageLocation: {
                type: "string",
              },
            },
            required: [
              "category",
              "subcategory",
              "consumptionType",
              "isHazmat",
              "storageLocation",
            ],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: `Du bist ein KI-Assistent für Baustellenbeschaffung in Deutschland und klassifizierst C-Materialien strukturiert für unsere Anwendung.
Ordne jedes Produkt anhand von Produktname und Rohkategorie des Lieferanten ein.
Antworte als JSON mit GENAU diesen Schlüsseln:
- "category": Muss genau einer dieser internen Systemwerte sein: ["Fasteners", "Electrical", "PPE", "Consumables", "Tools", "Site Supplies", "Other"].
- "subcategory": Muss genau einer dieser erlaubten deutschen Enum-Werte sein: [${allowedSubcategories.join(", ")}].
- "consumptionType": Muss genau "Consumable" oder "Asset/Tool" sein.
- "isHazmat": Boolean true oder false. True bei Spray, Farbe, Chemie, Klebstoff oder anderen typischen Gefahrstoffen.
- "storageLocation": Kurze deutsche Bezeichnung für den typischen Lagerort, z. B. "PSA-Schrank", "Werkzeuglager", "Container", "Chemieschrank", "Elektrolager".

Regeln:
- Wähle bei "subcategory" immer den passendsten erlaubten Enum-Wert.
- Erfinde keine neuen Enum-Werte.
- Wenn mehrere Werte möglich sind, nimm den praktischsten für die Baustellenbeschaffung.
- Bevorzuge deutsche Baustellenlogik, deutsche Begriffe und übliche Beschaffungslogik im Rohbau, Innenausbau, Tiefbau und Elektro.
- Nutze "Other" bei "category" nur, wenn keine der internen Hauptkategorien sinnvoll passt.`,
        },
        {
          role: "user",
          content: `Produkt: ${productName}\nRohkategorie des Lieferanten: ${rawCategory}`,
        },
      ],
      temperature: 0.1,
    });

    const result = JSON.parse(response.choices[0]?.message?.content || "{}") as {
      category: string;
      subcategory: string;
      consumptionType: "Consumable" | "Asset/Tool";
      isHazmat: boolean;
      storageLocation: string;
    };

    const normalizedCategory = assertNormalizedCategory(result.category);
    const subcategory = allowedSubcategories.includes(result.subcategory)
      ? result.subcategory
      : pickFallbackSubcategory(productName, rawCategory, allowedSubcategories);

    return {
      category: normalizedCategory,
      subcategory,
      typicalSite: subcategory,
      consumptionType: result.consumptionType || "Consumable",
      isHazmat: Boolean(result.isHazmat),
      storageLocation: result.storageLocation || "Lager",
    };
  } catch (error) {
    console.error("LLM Enrichment failed:", error);
    const fallbackSubcategory = pickFallbackSubcategory(
      productName,
      rawCategory,
      allowedSubcategories
    );

    return {
      category: normalizeCategory(rawCategory, productName),
      subcategory: fallbackSubcategory,
      typicalSite: fallbackSubcategory,
      consumptionType: "Consumable",
      isHazmat: false,
      storageLocation: "Lager",
    };
  }
}

