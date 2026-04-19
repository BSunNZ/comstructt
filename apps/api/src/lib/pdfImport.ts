import OpenAI from "openai";
import { enrichProductRowWithLLM } from "./catalog.js";
import { PDFParse } from "pdf-parse";

type CanonicalCsvRow = {
  artikel_id: string;
  artikelname: string;
  kategorie: string;
  einheit: string;
  preis_eur: string;
  lieferant: string;
  verbrauchsart: string;
  gefahrgut: string;
  lagerort: string;
  typische_baustelle: string;
};

type PartialExtractedItem = {
  supplierSku?: string;
  sourceName?: string;
  sourceCategory?: string;
  unit?: string;
  unitPrice?: number | string;
  supplierName?: string;
  consumptionType?: string;
  hazardous?: boolean | string;
  storageLocation?: string;
  typicalSite?: string;
  minOrderQty?: number | string;
};

type PdfExtractionHints = {
  suppliers?: string[];
  categories?: string[];
  units?: string[];
  consumptionTypes?: string[];
  storageLocations?: string[];
};

function normalizePrice(value: number | string | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "0";
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value).replace(/[^0-9,.-]/g, "").replace(",", "."));

  if (Number.isNaN(parsed)) {
    return "0";
  }

  return parsed.toFixed(2);
}

function normalizeHazardous(value: boolean | string | undefined): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const text = (value ?? "").toString().toLowerCase().trim();
  if (
    [
      "true",
      "yes",
      "1",
      "hazardous",
      "gefahrgut",
      "dangerous",
      "flammable",
      "entzundlich",
      "entzuendlich",
      "toxic",
      "giftig",
      "опасно",
      "peligroso",
      "dangereux",
      "pericoloso"
    ].includes(text)
  ) {
    return "true";
  }

  return "false";
}

function inferSupplierName(text: string, fileName: string): string {
  const explicitMatch = text.match(/(?:supplier|lieferant)\s*[:\-]\s*([^\n\r]{2,80})/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }

  const cleaned = fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : "PDF Supplier";
}

function splitPdfLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function toCanonicalRow(item: PartialExtractedItem, index: number, fallbackSupplier: string): CanonicalCsvRow {
  const sku = (item.supplierSku ?? "").toString().trim() || `PDF-${String(index + 1).padStart(4, "0")}`;

  return {
    artikel_id: sku,
    artikelname: (item.sourceName ?? "Unknown product").toString().trim(),
    kategorie: (item.sourceCategory ?? "Other").toString().trim(),
    einheit: (item.unit ?? "Stk").toString().trim(),
    preis_eur: normalizePrice(item.unitPrice),
    lieferant: (item.supplierName ?? fallbackSupplier).toString().trim() || fallbackSupplier,
    verbrauchsart: (item.consumptionType ?? "Einweg").toString().trim(),
    gefahrgut: normalizeHazardous(item.hazardous),
    lagerort: (item.storageLocation ?? "Unbekannt").toString().trim(),
    typische_baustelle: (item.typicalSite ?? "Alle").toString().trim(),
  };
}

function normalizeDetectedLanguage(lang: string): string {
  const value = lang.toLowerCase().trim();
  if (!value) return "unknown";
  if (value.includes("de")) return "de";
  if (value.includes("en")) return "en";
  if (value.includes("fr")) return "fr";
  if (value.includes("es")) return "es";
  if (value.includes("it")) return "it";
  if (value.includes("pl")) return "pl";
  if (value.includes("nl")) return "nl";
  return "unknown";
}

function tryParseDelimitedLine(line: string, supplierName: string): PartialExtractedItem | null {
  const delimiter = line.includes(";") ? ";" : line.includes("|") ? "|" : "\t";
  if (!delimiter) {
    return null;
  }

  const parts = line
    .split(delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length < 3) {
    return null;
  }

  const sku = parts.find((part) => /^[A-Za-z]{0,4}\d{2,}$/.test(part));
  const priceToken = [...parts].reverse().find((part) => /\d+[.,]\d{1,2}/.test(part));

  if (!sku || !priceToken) {
    return null;
  }

  const skuIndex = parts.indexOf(sku);
  const name = parts[skuIndex + 1] ?? parts[1] ?? "Unknown product";
  const category = parts[skuIndex + 2] ?? "Other";
  const unit = parts.find((part) => /^(stk|st|rolle|paar|dose|m|kg|l|eimer)$/i.test(part)) ?? "Stk";

  return {
    supplierSku: sku,
    sourceName: name,
    sourceCategory: category,
    unit,
    unitPrice: priceToken,
    supplierName
  };
}

function tryParseWhitespaceLine(line: string, supplierName: string): PartialExtractedItem | null {
  const UNIT_TOKENS = new Set([
    "stk",
    "st",
    "pcs",
    "piece",
    "pieces",
    "pair",
    "pairs",
    "rolle",
    "roll",
    "rolls",
    "dose",
    "can",
    "cans",
    "m",
    "meter",
    "kg",
    "g",
    "l",
    "ml",
    "eimer",
    "box",
    "pack",
  ]);

  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 5) return null;

  const sku = tokens[0];
  if (!/^[A-Za-z]{0,6}\d{2,}$/.test(sku)) return null;

  const isNumberToken = (v: string): boolean => /^\d+(?:[.,]\d+)?$/.test(v);
  const numberIndices = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isNumberToken(t))
    .map(({ i }) => i);
  if (numberIndices.length === 0) return null;

  const decimalIndices = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => /^\d+[.,]\d{1,2}$/.test(t))
    .map(({ i }) => i);

  const integerIndices = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => /^\d+$/.test(t))
    .map(({ i }) => i);

  // If line has unit price + line total, prefer the second decimal token as unit price.
  const priceIdx =
    decimalIndices.length >= 2
      ? decimalIndices[decimalIndices.length - 2]
      : decimalIndices.length === 1
        ? decimalIndices[0]
        : numberIndices[numberIndices.length - 1];

  let unitIdx = -1;
  for (let i = 1; i < priceIdx; i++) {
    const t = tokens[i].toLowerCase();
    if (UNIT_TOKENS.has(t)) {
      unitIdx = i;
      break;
    }
  }

  const qtyCandidates = integerIndices.filter((i) => i < priceIdx);
  const qtyIdx = qtyCandidates.length > 0 ? qtyCandidates[qtyCandidates.length - 1] : -1;

  if (unitIdx === -1 && qtyIdx > 1) {
    unitIdx = qtyIdx - 1;
  }

  const nameEnd = unitIdx > 1 ? unitIdx : qtyIdx > 1 ? qtyIdx : priceIdx;
  const name = tokens.slice(1, nameEnd).join(" ").trim();
  if (!name) return null;

  const unit = unitIdx > 0 ? tokens[unitIdx] : "Stk";
  const qty = qtyIdx > 0 ? Number(tokens[qtyIdx].replace(",", ".")) : undefined;

  return {
    supplierSku: sku,
    sourceName: name,
    sourceCategory: "Other",
    unit,
    unitPrice: tokens[priceIdx],
    supplierName,
    minOrderQty: Number.isFinite(qty) && Number(qty) > 0 ? Number(qty) : undefined,
  };
}

function tryParseWhitespaceLineLegacy(line: string, supplierName: string): PartialExtractedItem | null {
  const match = line.match(
    /^(?<sku>[A-Za-z]{0,4}\d{2,})\s+(?<name>.+?)\s+(?<unit>Stk|St|Rolle|Paar|Dose|m|kg|l|Eimer)\s+(?<price>\d+[.,]\d{1,2})$/i
  );

  if (!match?.groups) {
    return null;
  }

  return {
    supplierSku: match.groups.sku,
    sourceName: match.groups.name,
    sourceCategory: "Other",
    unit: match.groups.unit,
    unitPrice: match.groups.price,
    supplierName
  };
}

function extractRowsWithRules(text: string, supplierName: string): PartialExtractedItem[] {
  const lines = splitPdfLines(text);
  const rows: PartialExtractedItem[] = [];

  for (const line of lines) {
    const parsed =
      tryParseDelimitedLine(line, supplierName) ??
      tryParseWhitespaceLine(line, supplierName) ??
      tryParseWhitespaceLineLegacy(line, supplierName);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

async function extractRowsWithOpenAI(
  text: string,
  fileName: string,
  supplierHint: string,
  hints?: PdfExtractionHints
): Promise<PartialExtractedItem[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const openai = new OpenAI({ apiKey });
  const truncatedText = text.slice(0, 28000);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract procurement line items from supplier PDFs in any language (DE/EN/FR/ES/IT/PL/NL and mixed). Infer table columns and repeated row patterns even if headers differ. Return strict JSON object with this shape: {\"language\":\"de|en|fr|es|it|pl|nl|unknown\",\"items\":[...]}. Items can contain: supplierSku, sourceName, sourceCategory, unit, unitPrice, supplierName, consumptionType, hazardous, storageLocation, typicalSite, minOrderQty. If uncertain, leave field empty rather than hallucinating. Keep unitPrice numeric when possible."
      },
      {
        role: "user",
        content: [
          `File name: ${fileName}`,
          `Supplier hint: ${supplierHint}`,
          `Known suppliers in DB: ${(hints?.suppliers ?? []).slice(0, 40).join(", ") || "n/a"}`,
          `Known categories in DB: ${(hints?.categories ?? []).slice(0, 40).join(", ") || "n/a"}`,
          `Known units in DB: ${(hints?.units ?? []).slice(0, 30).join(", ") || "n/a"}`,
          `Known consumption types in DB: ${(hints?.consumptionTypes ?? []).slice(0, 20).join(", ") || "n/a"}`,
          `Known storage locations in DB: ${(hints?.storageLocations ?? []).slice(0, 20).join(", ") || "n/a"}`,
          "PDF text:",
          truncatedText,
        ].join("\n")
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return null;
  }

  const payload = JSON.parse(content) as { language?: string; items?: PartialExtractedItem[] };
  const _detectedLang = normalizeDetectedLanguage(payload.language ?? "unknown");
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.length > 0 ? items : null;
}

export type PdfExtractionResult = {
  rows: CanonicalCsvRow[];
  statusLog: string[];
};

export async function extractCanonicalRowsFromPdf(
  fileBuffer: Buffer,
  fileName: string,
  hints?: PdfExtractionHints
): Promise<PdfExtractionResult> {
  const statusLog: string[] = [];

  statusLog.push("PDF received");

  const parser = new PDFParse({ data: fileBuffer });
  statusLog.push("Extracting text from PDF");
  const parsed = await parser.getText();
  const text = (parsed.text ?? "").trim();
  await parser.destroy();

  if (!text) {
    statusLog.push("No extractable text found in PDF");
    return { rows: [], statusLog };
  }

  const supplierName = inferSupplierName(text, fileName);
  statusLog.push(`Inferred supplier: ${supplierName}`);

  let extractedItems: PartialExtractedItem[] = [];

  try {
    statusLog.push("Attempting OpenAI extraction (if available)");
    const aiItems = await extractRowsWithOpenAI(text, fileName, supplierName, hints);
    if (aiItems && aiItems.length > 0) {
      extractedItems = aiItems;
      statusLog.push(`OpenAI extraction succeeded, found ${aiItems.length} items`);
    } else {
      statusLog.push("OpenAI returned no structured items");
    }
  } catch (e) {
    statusLog.push(`OpenAI extraction failed: ${(e as Error)?.message ?? String(e)}`);
  }

  if (extractedItems.length === 0) {
    statusLog.push("Falling back to rule-based extraction");
    extractedItems = extractRowsWithRules(text, supplierName);
    statusLog.push(`Rule-based extraction found ${extractedItems.length} items`);
  }

  if (extractedItems.length === 0) {
    statusLog.push("Extraction unsuccessful: no product rows detected");
    return { rows: [], statusLog };
  }

  statusLog.push("Enriching extracted rows with normalization/LLM fallback");
  const enrichedItems: PartialExtractedItem[] = [];
  for (const item of extractedItems) {
    try {
      const enrichment = await enrichProductRowWithLLM(item.sourceName ?? "", item.sourceCategory ?? "");
      const mapped: PartialExtractedItem = {
        ...item,
        sourceCategory: enrichment.category ?? item.sourceCategory,
        consumptionType: enrichment.consumptionType ?? item.consumptionType,
        hazardous: enrichment.isHazmat ?? item.hazardous,
        storageLocation: enrichment.storageLocation ?? item.storageLocation,
        typicalSite: enrichment.typicalSite ?? item.typicalSite,
      };
      enrichedItems.push(mapped);
    } catch (e) {
      statusLog.push(`Enrichment failed for item: ${(e as Error)?.message ?? String(e)}`);
      enrichedItems.push(item);
    }
  }

  statusLog.push(`Extraction successful: ${enrichedItems.length} rows prepared`);

  const rows = enrichedItems.map((item, index) => toCanonicalRow(item, index, supplierName));
  return { rows, statusLog };
}

export async function extractCanonicalRowsFromPdfStream(
  fileBuffer: Buffer,
  fileName: string,
  logger: (msg: string) => void | Promise<void>,
  hints?: PdfExtractionHints
): Promise<CanonicalCsvRow[]> {
  logger("PDF received");

  const parser = new PDFParse({ data: fileBuffer });
  logger("Extracting text from PDF");
  const parsed = await parser.getText();
  const text = (parsed.text ?? "").trim();
  await parser.destroy();

  if (!text) {
    logger("No extractable text found in PDF");
    return [];
  }

  const supplierName = inferSupplierName(text, fileName);
  logger(`Inferred supplier: ${supplierName}`);

  let extractedItems: PartialExtractedItem[] = [];

  try {
    logger("Attempting OpenAI extraction (if available)");
    const aiItems = await extractRowsWithOpenAI(text, fileName, supplierName, hints);
    if (aiItems && aiItems.length > 0) {
      extractedItems = aiItems;
      logger(`OpenAI extraction succeeded, found ${aiItems.length} items`);
    } else {
      logger("OpenAI returned no structured items");
    }
  } catch (e) {
    logger(`OpenAI extraction failed: ${(e as Error)?.message ?? String(e)}`);
  }

  if (extractedItems.length === 0) {
    logger("Falling back to rule-based extraction");
    extractedItems = extractRowsWithRules(text, supplierName);
    logger(`Rule-based extraction found ${extractedItems.length} items`);
  }

  if (extractedItems.length === 0) {
    logger("Extraction unsuccessful: no product rows detected");
    return [];
  }

  logger("Enriching extracted rows with normalization/LLM fallback");
  const enrichedItems: PartialExtractedItem[] = [];
  for (const item of extractedItems) {
    try {
      const enrichment = await enrichProductRowWithLLM(item.sourceName ?? "", item.sourceCategory ?? "");
      const mapped: PartialExtractedItem = {
        ...item,
        sourceCategory: enrichment.category ?? item.sourceCategory,
        consumptionType: enrichment.consumptionType ?? item.consumptionType,
        hazardous: enrichment.isHazmat ?? item.hazardous,
        storageLocation: enrichment.storageLocation ?? item.storageLocation,
        typicalSite: enrichment.typicalSite ?? item.typicalSite,
      };
      enrichedItems.push(mapped);
    } catch (e) {
      logger(`Enrichment failed for item: ${(e as Error)?.message ?? String(e)}`);
      enrichedItems.push(item);
    }
  }

  logger(`Extraction successful: ${enrichedItems.length} rows prepared`);

  return enrichedItems.map((item, index) => toCanonicalRow(item, index, supplierName));
}
