import { randomUUID } from "node:crypto";
import type {
  CatalogItem,
  CatalogStatus,
  ConfirmImportResponse,
  CsvImportMapping,
  CsvImportPreviewResponse,
  ImportBatchListResponse,
  ImportBatchStatus,
  ImportBatchSummary,
  NormalizedCategory,
  UpdateCatalogItemInput
} from "@comstruct/shared";
import {
  assertCatalogStatus,
  assertNormalizedCategory,
  buildPreviewRow,
  sanitizeIncomingMapping,
  toStringRecord
} from "./catalog.js";

interface SupabaseImportRow {
  id: string;
  supplier_id: string | null;
  file_url: string;
  uploaded_by: string | null;
  created_at: string;
  import_status: ImportBatchStatus;
  original_filename: string | null;
  mapping_config: CsvImportMapping[] | null;
}

interface SupabaseRawProductRow {
  id: string;
  import_id: string;
  raw_name: string | null;
  raw_description: string | null;
  raw_price: number | null;
  raw_unit: string | null;
  raw_sku: string | null;
  ai_processed: boolean | null;
  created_at: string;
  supplier_name: string | null;
  raw_category: string | null;
  raw_consumption_type: string | null;
  raw_hazardous: boolean | null;
  raw_storage_location: string | null;
  raw_typical_site: string | null;
  source_payload: Record<string, unknown> | null;
}

interface SupabaseSupplier {
  id: string;
  name: string;
  import_type: string | null;
  contract_active: boolean | null;
  created_at: string;
}

interface SupabaseNormalizedProduct {
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
  source_name: string | null;
  source_category: string | null;
  catalog_status: CatalogStatus;
  is_c_material: boolean;
  consumption_type: string | null;
  hazardous: boolean | null;
  storage_location: string | null;
  typical_site: string | null;
}

interface SupabaseSupplierProductMapping {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  contract_price: number | null;
  min_order_qty: number | null;
  created_at: string;
}

interface CatalogFilters {
  supplier?: string;
  catalogStatus?: string;
  normalizedCategory?: string;
}

class ApiError extends Error {
  status: number;
  details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new ApiError(
      500,
      "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to apps/api/.env."
    );
  }

  return { url, serviceRoleKey };
}

async function supabaseRequest<T>(options: {
  path: string;
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string | undefined>;
  body?: unknown;
  prefer?: string;
}): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const requestUrl = new URL(`/rest/v1/${options.path}`, url);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      requestUrl.searchParams.set(key, value);
    }
  }

  const response = await fetch(requestUrl, {
    method: options.method ?? "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: options.prefer ?? "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T | { message?: string }) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload === "object" && payload && "message" in payload && payload.message
        ? payload.message
        : `Supabase request failed for ${options.path}.`
    );
  }

  return payload as T;
}

async function findSupplierByName(name: string): Promise<SupabaseSupplier | null> {
  const suppliers = await supabaseRequest<SupabaseSupplier[]>({
    path: "suppliers",
    query: {
      select: "*",
      name: `eq.${name}`,
      limit: "1"
    }
  });

  return suppliers[0] ?? null;
}

async function ensureSupplier(name: string): Promise<SupabaseSupplier> {
  const existing = await findSupplierByName(name);
  if (existing) {
    return existing;
  }

  const [supplier] = await supabaseRequest<SupabaseSupplier[]>({
    path: "suppliers",
    method: "POST",
    body: [
      {
        id: randomUUID(),
        name,
        import_type: "csv",
        contract_active: true,
        created_at: new Date().toISOString()
      }
    ]
  });

  return supplier;
}

function toImportSummary(
  importRow: SupabaseImportRow,
  importRows: SupabaseRawProductRow[]
): ImportBatchSummary {
  const supplierNames = Array.from(
    new Set(importRows.map((row) => row.supplier_name ?? "").filter(Boolean))
  );

  const firstPayload = importRows[0]?.source_payload ?? {};
  const detectedColumns = Object.keys(firstPayload);

  return {
    id: importRow.id,
    fileName: importRow.original_filename ?? importRow.file_url.replace("uploaded://", ""),
    status: importRow.import_status,
    totalRows: importRows.length,
    supplierNames,
    detectedColumns,
    createdAt: importRow.created_at
  };
}

function toCatalogItem(
  product: SupabaseNormalizedProduct,
  mapping: SupabaseSupplierProductMapping,
  supplier: SupabaseSupplier
): CatalogItem {
  return {
    id: product.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierSku: mapping.supplier_sku ?? "",
    sourceName: product.source_name ?? product.product_name,
    displayName: product.product_name,
    sourceCategory: product.source_category ?? product.subcategory ?? "",
    normalizedCategory: assertNormalizedCategory(product.category),
    unit: product.unit ?? "",
    unitPrice: mapping.contract_price ?? 0,
    consumptionType: product.consumption_type ?? "",
    hazardous: Boolean(product.hazardous),
    storageLocation: product.storage_location ?? "",
    typicalSite: product.typical_site ?? "",
    catalogStatus: assertCatalogStatus(product.catalog_status),
    isCMaterial: Boolean(product.is_c_material),
    createdAt: product.created_at
  };
}

export async function createCsvImportPreview(input: {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping?: CsvImportMapping[];
}): Promise<CsvImportPreviewResponse> {
  const columns = Object.keys(input.rows[0] ?? {});
  const mapping = sanitizeIncomingMapping(columns, input.mapping);
  const createdAt = new Date().toISOString();
  const importId = randomUUID();

  const rawImportPayload = {
    id: importId,
    supplier_id: null,
    file_url: `uploaded://${input.fileName}`,
    uploaded_by: null,
    created_at: createdAt,
    import_status: "draft",
    original_filename: input.fileName,
    mapping_config: mapping
  };

  await supabaseRequest<SupabaseImportRow[]>({
    path: "raw_imports",
    method: "POST",
    body: [rawImportPayload]
  });

  const rawProductRows = input.rows.map((row) => {
    const stringRow = toStringRecord(row);
    const preview = buildPreviewRow(stringRow, mapping);

    return {
      id: randomUUID(),
      import_id: importId,
      raw_name: preview.sourceName,
      raw_description: preview.sourceCategory,
      raw_price: preview.unitPrice,
      raw_unit: preview.unit,
      raw_sku: preview.supplierSku,
      ai_processed: false,
      created_at: createdAt,
      supplier_name: preview.supplierName,
      raw_category: preview.sourceCategory,
      raw_consumption_type: preview.consumptionType,
      raw_hazardous: preview.hazardous,
      raw_storage_location: preview.storageLocation,
      raw_typical_site: preview.typicalSite,
      source_payload: stringRow
    };
  });

  await supabaseRequest<SupabaseRawProductRow[]>({
    path: "raw_product_rows",
    method: "POST",
    body: rawProductRows
  });

  return {
    importBatch: {
      id: importId,
      fileName: input.fileName,
      status: "draft",
      totalRows: rawProductRows.length,
      supplierNames: Array.from(new Set(rawProductRows.map((row) => row.supplier_name ?? "").filter(Boolean))),
      detectedColumns: columns,
      createdAt
    },
    mapping,
    sampleRow: toStringRecord(input.rows[0] ?? {}),
    previewRows: rawProductRows.slice(0, 8).map((row) =>
      buildPreviewRow(toStringRecord(row.source_payload ?? {}), mapping)
    )
  };
}

export async function listImports(): Promise<ImportBatchListResponse> {
  const imports = await supabaseRequest<SupabaseImportRow[]>({
    path: "raw_imports",
    query: {
      select: "*",
      order: "created_at.desc"
    }
  });

  const rawRows = await supabaseRequest<SupabaseRawProductRow[]>({
    path: "raw_product_rows",
    query: {
      select: "*",
      order: "created_at.desc"
    }
  });

  return {
    imports: imports.map((importRow) =>
      toImportSummary(
        importRow,
        rawRows.filter((row) => row.import_id === importRow.id)
      )
    )
  };
}

export async function confirmImport(
  importId: string,
  mapping?: CsvImportMapping[]
): Promise<ConfirmImportResponse> {
  const [importRow] = await supabaseRequest<SupabaseImportRow[]>({
    path: "raw_imports",
    query: {
      select: "*",
      id: `eq.${importId}`,
      limit: "1"
    }
  });

  if (!importRow) {
    throw new ApiError(404, "Import batch not found.");
  }

  if (importRow.import_status === "confirmed") {
    throw new ApiError(409, "This import batch has already been confirmed.");
  }

  const rawRows = await supabaseRequest<SupabaseRawProductRow[]>({
    path: "raw_product_rows",
    query: {
      select: "*",
      import_id: `eq.${importId}`,
      order: "created_at.asc"
    }
  });

  const columns = Object.keys(rawRows[0]?.source_payload ?? {});
  const effectiveMapping = sanitizeIncomingMapping(
    columns,
    mapping ?? importRow.mapping_config ?? undefined
  );

  await supabaseRequest<SupabaseImportRow[]>({
    path: "raw_imports",
    method: "PATCH",
    query: {
      id: `eq.${importId}`
    },
    body: {
      mapping_config: effectiveMapping
    }
  });

  const supplierCache = new Map<string, SupabaseSupplier>();
  const now = new Date().toISOString();

  const normalizedProducts: SupabaseNormalizedProduct[] = [];
  const supplierMappings: SupabaseSupplierProductMapping[] = [];

  for (const row of rawRows) {
    const sourcePayload = toStringRecord(row.source_payload ?? {});
    const preview = buildPreviewRow(sourcePayload, effectiveMapping);
    const supplierName = preview.supplierName || "Unknown Supplier";
    let supplier = supplierCache.get(supplierName);

    if (!supplier) {
      supplier = await ensureSupplier(supplierName);
      supplierCache.set(supplierName, supplier);
    }

    const productId = randomUUID();
    normalizedProducts.push({
      id: productId,
      category: preview.normalizedCategory,
      subcategory: preview.sourceCategory,
      product_name: preview.sourceName,
      size: null,
      unit: preview.unit,
      packaging: null,
      confidence_score: 0.86,
      approved: false,
      created_at: now,
      source_name: preview.sourceName,
      source_category: preview.sourceCategory,
      catalog_status: "imported",
      is_c_material: true,
      consumption_type: preview.consumptionType,
      hazardous: preview.hazardous,
      storage_location: preview.storageLocation,
      typical_site: preview.typicalSite
    });

    supplierMappings.push({
      id: randomUUID(),
      supplier_id: supplier.id,
      product_id: productId,
      supplier_sku: preview.supplierSku,
      contract_price: preview.unitPrice,
      min_order_qty: 1,
      created_at: now
    });
  }

  if (normalizedProducts.length > 0) {
    await supabaseRequest<SupabaseNormalizedProduct[]>({
      path: "normalized_products",
      method: "POST",
      body: normalizedProducts
    });

    await supabaseRequest<SupabaseSupplierProductMapping[]>({
      path: "supplier_product_mapping",
      method: "POST",
      body: supplierMappings
    });
  }

  await supabaseRequest<SupabaseImportRow[]>({
    path: "raw_imports",
    method: "PATCH",
    query: {
      id: `eq.${importId}`
    },
    body: {
      import_status: "confirmed"
    }
  });

  return {
    importBatch: {
      ...toImportSummary(importRow, rawRows),
      status: "confirmed"
    },
    importedItems: normalizedProducts.length
  };
}

export async function listCatalogItems(filters: CatalogFilters): Promise<CatalogItem[]> {
  const products = await supabaseRequest<SupabaseNormalizedProduct[]>({
    path: "normalized_products",
    query: {
      select: "*",
      ...(filters.catalogStatus && filters.catalogStatus !== "all"
        ? { catalog_status: `eq.${filters.catalogStatus}` }
        : {}),
      ...(filters.normalizedCategory && filters.normalizedCategory !== "all"
        ? { category: `eq.${filters.normalizedCategory}` }
        : {}),
      order: "created_at.desc"
    }
  });

  if (products.length === 0) {
    return [];
  }

  const productIds = products.map((product) => product.id).join(",");
  const mappings = await supabaseRequest<SupabaseSupplierProductMapping[]>({
    path: "supplier_product_mapping",
    query: {
      select: "*",
      product_id: `in.(${productIds})`
    }
  });

  const supplierIds = Array.from(new Set(mappings.map((mapping) => mapping.supplier_id))).join(",");
  const suppliers = supplierIds
    ? await supabaseRequest<SupabaseSupplier[]>({
        path: "suppliers",
        query: {
          select: "*",
          id: `in.(${supplierIds})`
        }
      })
    : [];

  const productById = new Map(products.map((product) => [product.id, product]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const items = mappings.flatMap((mapping) => {
    const product = productById.get(mapping.product_id);
    const supplier = supplierById.get(mapping.supplier_id);

    if (!product || !supplier) {
      return [];
    }

    return [toCatalogItem(product, mapping, supplier)];
  });

  if (!filters.supplier || filters.supplier === "all") {
    return items;
  }

  return items.filter((item) => item.supplierName === filters.supplier);
}

export async function updateCatalogItem(
  itemId: string,
  input: UpdateCatalogItemInput
): Promise<CatalogItem> {
  const [existingProduct] = await supabaseRequest<SupabaseNormalizedProduct[]>({
    path: "normalized_products",
    query: {
      select: "*",
      id: `eq.${itemId}`,
      limit: "1"
    }
  });

  if (!existingProduct) {
    throw new ApiError(404, "Catalog item not found.");
  }

  const productPatch: Record<string, string | boolean> = {};

  if (input.displayName !== undefined) {
    productPatch.product_name = input.displayName.trim();
  }

  if (input.normalizedCategory !== undefined) {
    productPatch.category = input.normalizedCategory;
  }

  if (input.isCMaterial !== undefined) {
    productPatch.is_c_material = input.isCMaterial;
  }

  if (input.catalogStatus !== undefined) {
    productPatch.catalog_status = input.catalogStatus;
    productPatch.approved = input.catalogStatus === "published";
  }

  if (Object.keys(productPatch).length > 0) {
    await supabaseRequest<SupabaseNormalizedProduct[]>({
      path: "normalized_products",
      method: "PATCH",
      query: {
        id: `eq.${itemId}`
      },
      body: productPatch
    });
  }

  if (input.unitPrice !== undefined) {
    await supabaseRequest<SupabaseSupplierProductMapping[]>({
      path: "supplier_product_mapping",
      method: "PATCH",
      query: {
        product_id: `eq.${itemId}`
      },
      body: {
        contract_price: input.unitPrice
      }
    });
  }

  const items = await listCatalogItems({});
  const updatedItem = items.find((item) => item.id === itemId);

  if (!updatedItem) {
    throw new ApiError(500, "The catalog item was updated but could not be reloaded.");
  }

  return updatedItem;
}

export { ApiError };
