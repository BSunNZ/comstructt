import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type {
  CatalogItem,
  ConfirmImportResponse,
  CsvImportMapping,
  CsvImportPreviewResponse,
  DerivedFieldMapping,
  DatabaseColumnDefinition,
  DatabaseRow,
  DatabaseTableDefinition,
  DatabaseTableName,
  ImportBatchListResponse,
  ImportBatchSummary,
  UpdateCatalogItemInput,
  UpdateDatabaseRowInput,
} from "@comstruct/shared";
import {
  assertCatalogStatus,
  assertNormalizedCategory,
  buildPreviewRow,
  enrichProductRowWithLLM,
  normalizeProductIdentity,
  sanitizeIncomingDerivedMapping,
  sanitizeIncomingMapping,
  toStringRecord,
} from "./catalog.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://qzmadzboeabcvficrgwa.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFkemJvZWFiY3ZmaWNyZ3dhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNzExMiwiZXhwIjoyMDkyMDkzMTEyfQ.sa_p0GaypzO-8Qy9KOSPzFuBp26qJ1A7p0Hfsj72_M0";

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface DbImport {
  id: string;
  supplier_id: string | null;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
}

interface DbRawProductRow {
  id: string;
  import_id: string;
  raw_name: string | null;
  raw_description: string | null;
  raw_price: number | null;
  raw_unit: string | null;
  raw_sku: string | null;
  ai_processed: boolean | null;
  created_at: string;
}

interface DbSupplier {
  id: string;
  name: string;
  import_type: string | null;
  contract_active: boolean | null;
  created_at: string;
}

interface DbNormalizedProduct {
  id: string;
  category: string;
  subcategory: string | null;
  product_name: string;
  family_name: string | null;
  family_key: string | null;
  variant_label: string | null;
  variant_attributes: unknown[] | Record<string, unknown> | null;
  size: string | null;
  unit: string | null;
  packaging: string | null;
  confidence_score: number | null;
  approved: boolean | null;
  catalog_status: string | null;
  is_c_material: boolean | null;
  created_at: string;
  source_name: string | null;
  source_category: string | null;
  consumption_type: string | null;
  is_hazmat: boolean | null;
  hazardous: boolean | null;
  typical_site: string | null;
  storage_location: string | null;
}

interface DbSupplierProductMapping {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  contract_price: number | null;
  min_order_qty: number | null;
  created_at: string;
}

const DATABASE_SCHEMA: DatabaseTableDefinition = {
  name: "normalized_products",
  label: "Normalized Products",
  description: "Catalog-ready product records that procurement reviews and publishes.",
  primaryKey: "id",
  columns: [
    { name: "id", label: "ID", type: "uuid", nullable: false, editable: false },
    {
      name: "category",
      label: "Category",
      type: "string",
      nullable: false,
      editable: true,
    },
    {
      name: "subcategory",
      label: "Subcategory",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "product_name",
      label: "Product Name",
      type: "string",
      nullable: false,
      editable: true,
    },
    { name: "family_name", label: "Family Name", type: "string", nullable: true, editable: true },
    { name: "family_key", label: "Family Key", type: "string", nullable: true, editable: true },
    {
      name: "variant_label",
      label: "Variant Label",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "variant_attributes",
      label: "Variant Attributes",
      type: "json",
      nullable: true,
      editable: true,
    },
    { name: "size", label: "Size", type: "string", nullable: true, editable: true },
    { name: "unit", label: "Unit", type: "string", nullable: true, editable: true },
    {
      name: "packaging",
      label: "Packaging",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "confidence_score",
      label: "Confidence",
      type: "number",
      nullable: true,
      editable: true,
    },
    {
      name: "approved",
      label: "Approved",
      type: "boolean",
      nullable: true,
      editable: true,
    },
    {
      name: "consumption_type",
      label: "Consumption Type",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "is_hazmat",
      label: "Hazmat",
      type: "boolean",
      nullable: true,
      editable: true,
    },
    {
      name: "typical_site",
      label: "Typical Site",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "storage_location",
      label: "Storage Location",
      type: "string",
      nullable: true,
      editable: true,
    },
    {
      name: "weight_kg",
      label: "Weight (kg)",
      type: "number",
      nullable: true,
      editable: true,
    },
    {
      name: "created_at",
      label: "Created At",
      type: "datetime",
      nullable: false,
      editable: false,
    },
  ],
};

async function run<T>(
  q: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>
): Promise<T> {
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as T;
}

function getMissingSchemaColumn(error: unknown, tableName: string): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const match = error.message.match(/Could not find the '([^']+)' column of '([^']+)'/);
  if (!match) {
    return null;
  }

  const [, columnName, errorTableName] = match;
  return errorTableName === tableName ? columnName : null;
}

async function insertWithSchemaFallback<T extends object>(
  tableName: string,
  rows: T[],
  optionalColumns: string[]
): Promise<void> {
  let currentRows = rows.map((row) => ({ ...row }));
  const removableColumns = new Set(optionalColumns);

  while (true) {
    try {
      await run(db.from(tableName).insert(currentRows));
      return;
    } catch (error) {
      const missingColumn = getMissingSchemaColumn(error, tableName);
      if (!missingColumn || !removableColumns.has(missingColumn)) {
        throw error;
      }

      removableColumns.delete(missingColumn);
      currentRows = currentRows.map((row) => {
        const nextRow = { ...row } as Record<string, unknown>;
        delete nextRow[missingColumn];
        return nextRow as T;
      });
    }
  }
}

function getDatabaseTableDefinition(tableName: string): DatabaseTableDefinition {
  if (tableName === DATABASE_SCHEMA.name) {
    return DATABASE_SCHEMA;
  }

  throw new ApiError(404, `Unsupported database table "${tableName}".`);
}

function coerceDatabaseValue(column: DatabaseColumnDefinition, value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || (typeof value === "string" && value.trim() === "")) {
    if (column.nullable) {
      return null;
    }

    throw new ApiError(400, `"${column.label}" cannot be empty.`);
  }

  switch (column.type) {
    case "number": {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed)) {
        throw new ApiError(400, `"${column.label}" must be a valid number.`);
      }
      return parsed;
    }

    case "integer": {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(parsed)) {
        throw new ApiError(400, `"${column.label}" must be a whole number.`);
      }
      return parsed;
    }

    case "boolean": {
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes"].includes(normalized)) return true;
        if (["false", "0", "no"].includes(normalized)) return false;
      }

      throw new ApiError(400, `"${column.label}" must be true or false.`);
    }

    case "json": {
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          throw new ApiError(400, `"${column.label}" must contain valid JSON.`);
        }
      }

      return value;
    }

    case "string":
    case "uuid":
    case "datetime":
    default:
      return String(value);
  }
}

function toImportSummary(
  row: DbImport,
  productRows: DbRawProductRow[]
): ImportBatchSummary {
  const urlParts = row.file_url.split("://");
  const encodedStatus = urlParts[0] === "confirmed" ? "confirmed" : "draft";
  const fileName = urlParts[1] ?? row.file_url;

  const supplierNamesSet = new Set<string>();
  let detectedColumns: string[] = [];

  for (const productRow of productRows) {
    try {
      const payload = JSON.parse(productRow.raw_description ?? "{}");
      if (payload.supplierName) supplierNamesSet.add(payload.supplierName);
      if (detectedColumns.length === 0) {
        detectedColumns = Object.keys(payload.source_payload ?? {});
      }
    } catch {}
  }

  return {
    id: row.id,
    fileName,
    status: encodedStatus as "draft" | "confirmed",
    totalRows: productRows.length,
    supplierNames: Array.from(supplierNamesSet),
    detectedColumns,
    createdAt: row.created_at,
  };
}

function toCatalogItem(
  product: DbNormalizedProduct,
  mapping: DbSupplierProductMapping,
  supplier: DbSupplier
): CatalogItem {
  let catalogStatus: "imported" | "published" | "excluded" = "imported";
  if (product.catalog_status) {
    catalogStatus = assertCatalogStatus(product.catalog_status);
  } else if (product.approved) {
    catalogStatus = "published";
  }

  let isCMaterial = product.is_c_material ?? true;
  let sourceName = product.source_name ?? product.product_name;
  let sourceCategory = product.source_category ?? product.subcategory ?? "";
  let normalizedName = product.product_name;
  let familyName = product.family_name ?? product.product_name;
  let variantLabel = product.variant_label ?? product.size ?? "";
  let variantAttributes: CatalogItem["variantAttributes"] = Array.isArray(product.variant_attributes)
    ? product.variant_attributes
        .filter(
          (attribute): attribute is { key: string; value: string } =>
            Boolean(
              attribute &&
                typeof attribute === "object" &&
                "key" in attribute &&
                "value" in attribute
            )
        )
        .map((attribute) => ({
          key: String(attribute.key),
          value: String(attribute.value),
        }))
    : [];

  try {
    const meta = JSON.parse(product.packaging ?? "{}");
    if (meta.sourceName) sourceName = meta.sourceName;
    if (meta.sourceCategory) sourceCategory = meta.sourceCategory;
    if (meta.isCMaterial !== undefined) isCMaterial = Boolean(meta.isCMaterial);
    if (meta.normalizedName) normalizedName = String(meta.normalizedName);
    if (!product.family_name && meta.familyName) familyName = String(meta.familyName);
    if (!product.variant_label && !product.size && meta.variantLabel) {
      variantLabel = String(meta.variantLabel);
    }
    if (Array.isArray(meta.variantAttributes)) {
      variantAttributes = meta.variantAttributes
        .filter(
          (attribute: unknown): attribute is { key: string; value: string } =>
            Boolean(
              attribute &&
                typeof attribute === "object" &&
                "key" in attribute &&
                "value" in attribute
            )
        )
        .map((attribute: { key: string; value: string }) => ({
          key: String(attribute.key),
          value: String(attribute.value),
        }));
    }
  } catch {}

  return {
    id: product.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierSku: mapping.supplier_sku ?? "",
    sourceName,
    normalizedName,
    familyName,
    variantLabel,
    variantAttributes,
    displayName: product.product_name,
    sourceCategory,
    normalizedCategory: assertNormalizedCategory(product.category),
    unit: product.unit ?? "",
    unitPrice: mapping.contract_price ?? 0,
    consumptionType: product.consumption_type ?? "",
    hazardous: Boolean(product.is_hazmat ?? product.hazardous),
    storageLocation: product.storage_location ?? "",
    typicalSite: product.typical_site ?? "",
    catalogStatus: assertCatalogStatus(catalogStatus),
    isCMaterial,
    createdAt: product.created_at,
  };
}

async function findSupplierByName(name: string): Promise<DbSupplier | null> {
  const { data, error } = await db.from("suppliers").select("*").eq("name", name).limit(1);
  if (error) throw new ApiError(500, error.message);
  return data?.[0] ?? null;
}

async function ensureSupplier(name: string): Promise<DbSupplier> {
  const existing = await findSupplierByName(name);
  if (existing) return existing;

  const rows = await run<DbSupplier[]>(
    db
      .from("suppliers")
      .insert([
        {
          id: randomUUID(),
          name,
          import_type: "csv",
          contract_active: true,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
  );

  const supplier = rows[0];
  if (!supplier) throw new ApiError(500, "Failed to create supplier.");
  return supplier;
}

export async function createCsvImportPreview(input: {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping?: CsvImportMapping[];
  derivedMapping?: DerivedFieldMapping[];
  customCategories?: string;
}): Promise<CsvImportPreviewResponse> {
  const columns = [...Object.keys(input.rows[0] ?? {}), "AI Subcategory (Preview)"];
  const mapping = sanitizeIncomingMapping(columns, input.mapping);
  const derivedMapping = sanitizeIncomingDerivedMapping(input.derivedMapping);
  const createdAt = new Date().toISOString();
  const importId = randomUUID();

  const stringifiedFirstRow = toStringRecord(input.rows[0] ?? {});
  const firstPreview = buildPreviewRow(stringifiedFirstRow, mapping);
  const supplierName = firstPreview.supplierName || "Unknown Supplier";
  const supplier = await ensureSupplier(supplierName);

  await run(
    db.from("raw_imports").insert([
      {
        id: importId,
        supplier_id: supplier.id,
        file_url: `draft://${input.fileName}`,
        uploaded_by: "6792769c-f841-4715-b5f3-335a155a95bc",
        created_at: createdAt,
      },
    ])
  );

  const rawProductRows = input.rows.map((row) => {
    const stringRow = toStringRecord(row);
    const preview = buildPreviewRow(stringRow, mapping);

    return {
      id: randomUUID(),
      import_id: importId,
      raw_name: preview.sourceName,
      raw_description: JSON.stringify({
        supplierName: preview.supplierName,
        source_payload: stringRow,
      }),
      raw_price: preview.unitPrice,
      raw_unit: preview.unit,
      raw_sku: preview.supplierSku,
      ai_processed: false,
      supplier_name: preview.supplierName,
      raw_category: preview.sourceCategory,
      raw_consumption_type: preview.consumptionType,
      raw_hazardous: preview.hazardous,
      raw_storage_location: preview.storageLocation,
      raw_typical_site: preview.typicalSite,
      created_at: createdAt,
    };
  });

  await insertWithSchemaFallback("raw_product_rows", rawProductRows, [
    "supplier_name",
    "raw_category",
    "raw_consumption_type",
    "raw_hazardous",
    "raw_storage_location",
    "raw_typical_site",
  ]);

  return {
    importBatch: {
      id: importId,
      fileName: input.fileName,
      status: "draft",
      totalRows: rawProductRows.length,
      supplierNames: Array.from(
        new Set(
          rawProductRows
            .map((row) => {
              try {
                return JSON.parse(row.raw_description ?? "{}").supplierName ?? "";
              } catch {
                return "";
              }
            })
            .filter(Boolean)
        )
      ),
      detectedColumns: columns,
      createdAt,
    },
    mapping,
    derivedMapping,
    sampleRows: await Promise.all(
      input.rows.map(async (row) => {
        const stringRow = toStringRecord(row ?? {});
        const preview = buildPreviewRow(stringRow, mapping);
        const enriched = await enrichProductRowWithLLM(
          preview.sourceName,
          preview.sourceCategory,
          input.customCategories
        );

        return {
          ...stringRow,
          "AI Subcategory (Preview)": enriched.subcategory,
        };
      })
    ),
    previewRows: rawProductRows.map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(row.raw_description ?? "{}").source_payload ?? {};
      } catch {}

      return buildPreviewRow(toStringRecord(payload as Record<string, unknown>), mapping);
    }),
  };
}

export async function listImports(): Promise<ImportBatchListResponse> {
  const imports = await run<DbImport[]>(
    db.from("raw_imports").select("*").order("created_at", { ascending: false })
  );

  const rawRows = await run<DbRawProductRow[]>(
    db.from("raw_product_rows").select("*").order("created_at", { ascending: false })
  );

  return {
    imports: imports.map((importRow) =>
      toImportSummary(
        importRow,
        rawRows.filter((row) => row.import_id === importRow.id)
      )
    ),
  };
}

export async function confirmImport(
  importId: string,
  requestedMapping?: CsvImportMapping[],
  requestedDerivedMapping?: DerivedFieldMapping[],
  customCategories?: string
): Promise<ConfirmImportResponse> {
  const importRows = await run<DbImport[]>(
    db.from("raw_imports").select("*").eq("id", importId).limit(1)
  );

  const importRow = importRows[0];
  if (!importRow) throw new ApiError(404, "Import batch not found.");
  if (importRow.file_url.startsWith("confirmed://")) {
    throw new ApiError(409, "This import batch has already been confirmed.");
  }

  const rawRows = await run<DbRawProductRow[]>(
    db
      .from("raw_product_rows")
      .select("*")
      .eq("import_id", importId)
      .order("created_at", { ascending: true })
  );

  let columns: string[] = [];
  try {
    columns = Object.keys(JSON.parse(rawRows[0]?.raw_description ?? "{}").source_payload ?? {});
  } catch {}

  const effectiveMapping = sanitizeIncomingMapping(columns, requestedMapping ?? []);
  const effectiveDerivedMapping = sanitizeIncomingDerivedMapping(requestedDerivedMapping);
  const mappedTargets = new Set(effectiveMapping.map((entry) => entry.target));
  const derivedTargetByField = new Map(
    effectiveDerivedMapping.map((entry) => [entry.field, entry.target])
  );
  const supplierCache = new Map<string, DbSupplier>();
  const now = new Date().toISOString();
  const normalizedProducts: DbNormalizedProduct[] = [];
  const supplierMappings: DbSupplierProductMapping[] = [];

  for (const row of rawRows) {
    let sourcePayload = {};
    try {
      sourcePayload = JSON.parse(row.raw_description ?? "{}").source_payload ?? {};
    } catch {}

    const stringifiedPayload = toStringRecord(sourcePayload as Record<string, unknown>);
    const preview = buildPreviewRow(stringifiedPayload, effectiveMapping);
    const supplierName = preview.supplierName || "Unknown Supplier";
    let supplier = supplierCache.get(supplierName);

    if (!supplier) {
      supplier = await ensureSupplier(supplierName);
      supplierCache.set(supplierName, supplier);
    }

    const enriched = await enrichProductRowWithLLM(
      preview.sourceName,
      preview.sourceCategory,
      customCategories
    );
    const identity = normalizeProductIdentity(preview.sourceName, {
      familyName: preview.familyName,
      variantLabel: preview.variantLabel,
    });

    const productId = randomUUID();
    const packagingMeta: Record<string, unknown> = {
      sourceName: preview.sourceName,
      sourceCategory: preview.sourceCategory,
      normalizedName: identity.normalizedName,
      familyName: identity.familyName,
      familyKey: identity.familyKey,
      variantLabel: identity.variantLabel,
      variantAttributes: identity.variantAttributes,
      isCMaterial: preview.isCMaterial,
    };
    let productName = identity.normalizedName;
    let sourceName = preview.sourceName;
    let sourceCategory = preview.sourceCategory;
    let familyName: string | null = identity.familyName;
    let familyKey: string | null = identity.familyKey;
    let variantLabel: string | null = identity.variantLabel || null;
    let variantAttributes: unknown[] = identity.variantAttributes;
    let size = identity.variantLabel || null;
    let category = preview.normalizedCategory || enriched.category;
    let subcategory = preview.subcategory || enriched.subcategory;

    switch (derivedTargetByField.get("familyName")) {
      case "product_name":
        productName = identity.familyName;
        familyName = null;
        familyKey = null;
        break;
      case "source_name":
        sourceName = identity.familyName;
        familyName = null;
        familyKey = null;
        break;
      case "packaging.familyName":
        familyName = null;
        familyKey = null;
        break;
      case "family_name":
      default:
        break;
    }

    switch (derivedTargetByField.get("variantLabel")) {
      case "product_name":
        productName = identity.variantLabel || productName;
        variantLabel = null;
        size = null;
        break;
      case "source_name":
        sourceName = identity.variantLabel || sourceName;
        variantLabel = null;
        size = null;
        break;
      case "packaging.variantLabel":
        variantLabel = null;
        size = null;
        break;
      case "size":
        variantLabel = null;
        break;
      case "variant_label":
      default:
        break;
    }

    switch (derivedTargetByField.get("variantAttributes")) {
      case "packaging.variantAttributes":
        variantAttributes = [];
        break;
      case "variant_attributes":
      default:
        break;
    }

    switch (derivedTargetByField.get("normalizedCategory")) {
      case "source_category":
        sourceCategory = preview.normalizedCategory;
        category = enriched.category;
        subcategory = preview.subcategory || enriched.subcategory;
        break;
      case "subcategory":
        category = enriched.category;
        subcategory = preview.normalizedCategory;
        break;
      case "category":
      default:
        category = preview.normalizedCategory || enriched.category;
        subcategory = preview.subcategory || enriched.subcategory;
        break;
    }

    normalizedProducts.push({
      id: productId,
      category,
      subcategory,
      product_name: productName,
      family_name: familyName,
      family_key: familyKey,
      variant_label: variantLabel,
      variant_attributes: variantAttributes,
      size,
      unit: preview.unit,
      packaging: JSON.stringify(packagingMeta),
      confidence_score: 0.95,
      approved: preview.catalogStatus === "published",
      catalog_status: preview.catalogStatus,
      created_at: now,
      source_name: sourceName,
      source_category: sourceCategory,
      is_c_material: preview.isCMaterial,
      consumption_type: mappedTargets.has("consumptionType")
        ? preview.consumptionType
        : enriched.consumptionType,
      is_hazmat: mappedTargets.has("hazardous")
        ? preview.hazardous
        : enriched.isHazmat,
      hazardous: mappedTargets.has("hazardous")
        ? preview.hazardous
        : enriched.isHazmat,
      storage_location: mappedTargets.has("storageLocation")
        ? preview.storageLocation
        : enriched.storageLocation,
      typical_site: mappedTargets.has("typicalSite")
        ? preview.typicalSite
        : enriched.typicalSite,
    });

    supplierMappings.push({
      id: randomUUID(),
      supplier_id: supplier.id,
      product_id: productId,
      supplier_sku: preview.supplierSku,
      contract_price: preview.unitPrice,
      min_order_qty: 1,
      created_at: now,
    });
  }

  if (normalizedProducts.length > 0) {
    await insertWithSchemaFallback("normalized_products", normalizedProducts, [
      "family_name",
      "family_key",
      "variant_label",
      "variant_attributes",
      "catalog_status",
      "is_c_material",
      "source_name",
      "source_category",
      "hazardous",
      "storage_location",
      "typical_site",
    ]);
    await run(db.from("supplier_product_mapping").insert(supplierMappings));
  }

  const updatedFileUrl = importRow.file_url.replace("draft://", "confirmed://");
  await run(db.from("raw_imports").update({ file_url: updatedFileUrl }).eq("id", importId));

  return {
    importBatch: {
      ...toImportSummary(importRow, rawRows),
      status: "confirmed",
    },
    importedItems: normalizedProducts.length,
  };
}

export async function listCatalogItems(filters: {
  supplier?: string;
  catalogStatus?: string;
  normalizedCategory?: string;
}): Promise<CatalogItem[]> {
  let query = db.from("normalized_products").select("*").order("created_at", { ascending: false });

  if (filters.catalogStatus && filters.catalogStatus !== "all") {
    query = query.eq("catalog_status", filters.catalogStatus);
  }

  if (filters.normalizedCategory && filters.normalizedCategory !== "all") {
    query = query.eq("category", filters.normalizedCategory);
  }

  const products = await run<DbNormalizedProduct[]>(query);
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const mappings = await run<DbSupplierProductMapping[]>(
    db.from("supplier_product_mapping").select("*").in("product_id", productIds)
  );

  const supplierIds = Array.from(new Set(mappings.map((mapping) => mapping.supplier_id)));
  const suppliers =
    supplierIds.length > 0
      ? await run<DbSupplier[]>(db.from("suppliers").select("*").in("id", supplierIds))
      : [];

  const productById = new Map(products.map((product) => [product.id, product]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const items = mappings.flatMap((mapping) => {
    const product = productById.get(mapping.product_id);
    const supplier = supplierById.get(mapping.supplier_id);
    if (!product || !supplier) return [];
    return [toCatalogItem(product, mapping, supplier)];
  });

  if (!filters.supplier || filters.supplier === "all") return items;
  return items.filter((item) => item.supplierName === filters.supplier);
}

export async function updateCatalogItem(
  itemId: string,
  input: UpdateCatalogItemInput
): Promise<CatalogItem> {
  const existing = await run<DbNormalizedProduct[]>(
    db.from("normalized_products").select("*").eq("id", itemId).limit(1)
  );

  if (!existing[0]) throw new ApiError(404, "Catalog item not found.");

  const productPatch: Record<string, string | boolean | null> = {};

  if (input.displayName !== undefined) {
    productPatch.product_name = input.displayName.trim();
  }

  if (input.normalizedCategory !== undefined) {
    productPatch.category = input.normalizedCategory;
  }

  if (input.isCMaterial !== undefined) {
    let meta: Record<string, unknown> = {};
    try {
      meta = existing[0].packaging ? JSON.parse(existing[0].packaging) : {};
    } catch {}

    meta.isCMaterial = input.isCMaterial;
    productPatch.packaging = JSON.stringify(meta);
    productPatch.is_c_material = input.isCMaterial;
  }

  if (input.catalogStatus !== undefined) {
    productPatch.approved = input.catalogStatus === "published";
    productPatch.catalog_status = input.catalogStatus;
  }

  if (Object.keys(productPatch).length > 0) {
    await run(db.from("normalized_products").update(productPatch).eq("id", itemId));
  }

  if (input.unitPrice !== undefined) {
    await run(
      db
        .from("supplier_product_mapping")
        .update({ contract_price: input.unitPrice })
        .eq("product_id", itemId)
    );
  }

  const items = await listCatalogItems({});
  const updated = items.find((item) => item.id === itemId);
  if (!updated) {
    throw new ApiError(500, "The catalog item was updated but could not be reloaded.");
  }

  return updated;
}

export function listDatabaseTables(): DatabaseTableDefinition[] {
  return [DATABASE_SCHEMA];
}

export async function listDatabaseRows(tableName: string): Promise<{
  table: DatabaseTableDefinition;
  rows: DatabaseRow[];
  rowCount: number;
}> {
  const table = getDatabaseTableDefinition(tableName);
  const rows = await run<DatabaseRow[]>(
    db.from(table.name).select("*").order(table.primaryKey, { ascending: true })
  );

  return {
    table,
    rows,
    rowCount: rows.length,
  };
}

export async function updateDatabaseRow(
  tableName: string,
  rowId: string,
  input: UpdateDatabaseRowInput
): Promise<DatabaseRow> {
  const table = getDatabaseTableDefinition(tableName);
  const editableColumns = new Map(
    table.columns.filter((column) => column.editable).map((column) => [column.name, column])
  );

  const patch: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(input.values ?? {})) {
    const column = editableColumns.get(key);
    if (!column) {
      throw new ApiError(400, `"${key}" is not editable in ${table.label}.`);
    }

    patch[key] = coerceDatabaseValue(column, rawValue);
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "No editable values were provided.");
  }

  const existing = await run<DatabaseRow[]>(
    db.from(table.name).select("*").eq(table.primaryKey, rowId).limit(1)
  );

  if (!existing[0]) {
    throw new ApiError(404, `${table.label} row not found.`);
  }

  const updatedRows = await run<DatabaseRow[]>(
    db
      .from(table.name)
      .update(patch)
      .eq(table.primaryKey, rowId)
      .select("*")
      .limit(1)
  );

  const updated = updatedRows[0];
  if (!updated) {
    throw new ApiError(500, `${table.label} row was updated but could not be reloaded.`);
  }

  return updated;
}
