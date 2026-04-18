import {
  CATALOG_STATUSES,
  CSV_IMPORT_TARGETS,
  NORMALIZED_CATEGORIES,
  type CatalogStatus,
  type CsvImportFieldTarget,
  type CsvImportMapping,
  type ImportPreviewRow,
  type NormalizedCategory
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

export function buildDefaultMapping(columns: string[]): CsvImportMapping[] {
  const targetByColumn = new Map<string, CsvImportFieldTarget>([
    ["artikel_id", "supplierSku"],
    ["artikelname", "sourceName"],
    ["kategorie", "sourceCategory"],
    ["einheit", "unit"],
    ["preis_eur", "unitPrice"],
    ["lieferant", "supplierName"],
    ["verbrauchsart", "consumptionType"],
    ["gefahrgut", "hazardous"],
    ["lagerort", "storageLocation"],
    ["typische_baustelle", "typicalSite"]
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

export function normalizeCategory(value: string): NormalizedCategory {
  const lower = value.trim().toLowerCase();

  if (!lower) {
    return "Other";
  }

  if (lower.includes("befestigung") || lower.includes("kunststoff")) {
    return "Fasteners";
  }

  if (lower.includes("elektro")) {
    return "Electrical";
  }

  if (lower.includes("psa")) {
    return "PPE";
  }

  if (lower.includes("verbrauch") || lower.includes("chemie")) {
    return "Consumables";
  }

  if (lower.includes("werkzeug")) {
    return "Tools";
  }

  if (lower.includes("baustelle") || lower.includes("site")) {
    return "Site Supplies";
  }

  return "Other";
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

  return {
    supplierName: valueByTarget.get("supplierName")?.trim() ?? "",
    supplierSku: valueByTarget.get("supplierSku")?.trim() ?? "",
    sourceName: valueByTarget.get("sourceName")?.trim() ?? "",
    sourceCategory: valueByTarget.get("sourceCategory")?.trim() ?? "",
    normalizedCategory: normalizeCategory(valueByTarget.get("sourceCategory") ?? ""),
    unit: valueByTarget.get("unit")?.trim() ?? "",
    unitPrice: normalizePrice(valueByTarget.get("unitPrice") ?? "0"),
    consumptionType: valueByTarget.get("consumptionType")?.trim() ?? "",
    hazardous: normalizeBoolean(valueByTarget.get("hazardous") ?? "false"),
    storageLocation: valueByTarget.get("storageLocation")?.trim() ?? "",
    typicalSite: valueByTarget.get("typicalSite")?.trim() ?? "",
    isCMaterial: true
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
