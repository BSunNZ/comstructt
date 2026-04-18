import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type {
  CatalogItem,
  ConfirmImportResponse,
  CsvImportMapping,
  CsvImportPreviewResponse,
  ImportBatchListResponse,
  ImportBatchSummary,
  UpdateCatalogItemInput,
} from "@comstruct/shared";
import {
  assertCatalogStatus,
  assertNormalizedCategory,
  buildPreviewRow,
  enrichProductRowWithLLM,
  sanitizeIncomingMapping,
  toStringRecord,
} from "./catalog.js";

// ── Supabase client ──────────────────────────────────────────────────────────
// Credentials are embedded directly — no env loading required.
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://qzmadzboeabcvficrgwa.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWFkemJvZWFiY3ZmaWNyZ3dhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjUxNzExMiwiZXhwIjoyMDkyMDkzMTEyfQ.sa_p0GaypzO-8Qy9KOSPzFuBp26qJ1A7p0Hfsj72_M0";

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Error class ──────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ── DB row types ─────────────────────────────────────────────────────────────
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
  size: string | null;
  unit: string | null;
  packaging: string | null;
  confidence_score: number | null;
  approved: boolean | null;
  created_at: string;
  consumption_type: string | null;
  is_hazmat: boolean | null;
  typical_site: string | null;
  storage_location: string | null;
  weight_kg: number | null;
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

// ── DB query helper ───────────────────────────────────────────────────────────
// Unwraps the { data, error } Supabase response and throws on error.
async function run<T>(
  q: Promise<{ data: T | null; error: { message: string; code?: string } | null }>
): Promise<T> {
  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);
  return (data ?? []) as T;
}

// ── Private helpers ───────────────────────────────────────────────────────────
function toImportSummary(
  row: DbImport,
  productRows: DbRawProductRow[]
): ImportBatchSummary {
  const urlParts = row.file_url.split("://");
  const encodedStatus = urlParts[0] === "confirmed" ? "confirmed" : "draft";
  const fileName = urlParts[1] ?? row.file_url;

  const supplierNamesSet = new Set<string>();
  let detectedColumns: string[] = [];

  for (const r of productRows) {
    try {
      const payload = JSON.parse(r.raw_description ?? "{}");
      if (payload.supplierName) supplierNamesSet.add(payload.supplierName);
      if (detectedColumns.length === 0) detectedColumns = Object.keys(payload.source_payload ?? {});
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
  let catalogStatus: "imported" | "published" | "excluded" = product.approved ? "published" : "imported";
  if (product.size === "excluded") catalogStatus = "excluded";

  let isCMaterial = true;
  let sourceName = product.product_name;
  let sourceCategory = product.subcategory ?? "";
  
  try {
    const meta = JSON.parse(product.packaging ?? "{}");
    if (meta.sourceName) sourceName = meta.sourceName;
    if (meta.sourceCategory) sourceCategory = meta.sourceCategory;
    if (meta.isCMaterial !== undefined) isCMaterial = meta.isCMaterial;
  } catch {}

  return {
    id: product.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierSku: mapping.supplier_sku ?? "",
    sourceName,
    displayName: product.product_name,
    sourceCategory,
    normalizedCategory: assertNormalizedCategory(product.category),
    unit: product.unit ?? "",
    unitPrice: mapping.contract_price ?? 0,
    consumptionType: product.consumption_type ?? "",
    hazardous: Boolean(product.is_hazmat),
    storageLocation: product.storage_location ?? "",
    typicalSite: product.typical_site ?? "",
    catalogStatus: assertCatalogStatus(catalogStatus),
    isCMaterial,
    createdAt: product.created_at,
  };
}

async function findSupplierByName(name: string): Promise<DbSupplier | null> {
  const { data, error } = await db
    .from("suppliers")
    .select("*")
    .eq("name", name)
    .limit(1);
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

// ── Exported API functions ────────────────────────────────────────────────────

export async function createCsvImportPreview(input: {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping?: CsvImportMapping[];
}): Promise<CsvImportPreviewResponse> {
  const columns = Object.keys(input.rows[0] ?? {});
  const mapping = sanitizeIncomingMapping(columns, input.mapping);
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
      created_at: createdAt,
    };
  });

  await run(db.from("raw_product_rows").insert(rawProductRows));

  return {
    importBatch: {
      id: importId,
      fileName: input.fileName,
      status: "draft",
      totalRows: rawProductRows.length,
      supplierNames: Array.from(
        new Set(rawProductRows.map((r) => {
          try {
            return JSON.parse(r.raw_description ?? "{}").supplierName ?? "";
          } catch {
            return "";
          }
        }).filter(Boolean))
      ),
      detectedColumns: columns,
      createdAt,
    },
    mapping,
    sampleRow: toStringRecord(input.rows[0] ?? {}),
    previewRows: rawProductRows
      .slice(0, 8)
      .map((row) => {
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
    db
      .from("raw_product_rows")
      .select("*")
      .order("created_at", { ascending: false })
  );

  return {
    imports: imports.map((importRow) =>
      toImportSummary(
        importRow,
        rawRows.filter((r) => r.import_id === importRow.id)
      )
    ),
  };
}

export async function confirmImport(
  importId: string,
  mapping?: CsvImportMapping[]
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
  
  const effectiveMapping = sanitizeIncomingMapping(
    columns,
    mapping ?? [] // Default to empty array if mapping not stored
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

    const enriched = await enrichProductRowWithLLM(preview.sourceName, preview.sourceCategory);

    const productId = randomUUID();
    normalizedProducts.push({
      id: productId,
      category: enriched.category,
      subcategory: preview.sourceCategory,
      product_name: preview.sourceName,
      size: null,
      unit: preview.unit, // Map actual unit to unit column
      packaging: JSON.stringify({
        sourceName: preview.sourceName,
        sourceCategory: preview.sourceCategory,
        isCMaterial: true,
      }), // Map extra metadata into packaging column
      confidence_score: 0.95, // High because AI mapped it
      approved: false,
      created_at: now,
      consumption_type: enriched.consumptionType,
      is_hazmat: enriched.isHazmat,
      storage_location: enriched.storageLocation,
      typical_site: enriched.typicalSite,
      weight_kg: null,
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
    await run(db.from("normalized_products").insert(normalizedProducts));
    await run(db.from("supplier_product_mapping").insert(supplierMappings));
  }

  const updatedFileUrl = importRow.file_url.replace("draft://", "confirmed://");
  await run(
    db
      .from("raw_imports")
      .update({ file_url: updatedFileUrl })
      .eq("id", importId)
  );

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
  let q = db
    .from("normalized_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.catalogStatus && filters.catalogStatus !== "all") {
    if (filters.catalogStatus === "published") q = q.eq("approved", true);
    if (filters.catalogStatus === "imported") q = q.eq("approved", false);
    if (filters.catalogStatus === "excluded") q = q.eq("size", "excluded");
  }
  if (filters.normalizedCategory && filters.normalizedCategory !== "all") {
    q = q.eq("category", filters.normalizedCategory);
  }

  const products = await run<DbNormalizedProduct[]>(q);
  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);
  const mappings = await run<DbSupplierProductMapping[]>(
    db.from("supplier_product_mapping").select("*").in("product_id", productIds)
  );

  const supplierIds = Array.from(new Set(mappings.map((m) => m.supplier_id)));
  const suppliers =
    supplierIds.length > 0
      ? await run<DbSupplier[]>(
          db.from("suppliers").select("*").in("id", supplierIds)
        )
      : [];

  const productById = new Map(products.map((p) => [p.id, p]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

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
  if (input.displayName !== undefined)
    productPatch.product_name = input.displayName.trim();
  if (input.normalizedCategory !== undefined)
    productPatch.category = input.normalizedCategory;
  if (input.isCMaterial !== undefined) {
    let meta: Record<string, unknown> = {};
    try {
      meta = existing[0].packaging ? JSON.parse(existing[0].packaging) : {};
    } catch {}
    meta.isCMaterial = input.isCMaterial;
    productPatch.packaging = JSON.stringify(meta);
  }
  if (input.catalogStatus !== undefined) {
    productPatch.approved = input.catalogStatus === "published";
    if (input.catalogStatus === "excluded") {
      productPatch.size = "excluded";
    } else {
      productPatch.size = null;
    }
  }

  if (Object.keys(productPatch).length > 0) {
    await run(
      db.from("normalized_products").update(productPatch).eq("id", itemId)
    );
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
  if (!updated)
    throw new ApiError(
      500,
      "The catalog item was updated but could not be reloaded."
    );
  return updated;
}
