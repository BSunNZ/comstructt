import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type {
  ApprovalRoute,
  CatalogItem,
  ConfirmImportResponse,
  CreateProjectInput,
  CsvImportMapping,
  CsvImportPreviewResponse,
  DerivedFieldMapping,
  DatabaseColumnDefinition,
  DatabaseRow,
  DatabaseTableDefinition,
  DatabaseTableName,
  ImportBatchListResponse,
  ImportBatchSummary,
  NormalizedCategory,
  ProjectPriceImportFieldTarget,
  ProjectPriceImportMapping,
  ProjectPriceImportPreviewResponse,
  ProjectSummary,
  ProcurementOrder,
  ProcurementOrderActionInput,
  ProcurementOrderCreateInput,
  ProcurementOrderItem,
  ProcurementOrderSettings,
  ProcurementOrdersResponse,
  UpdateCatalogItemInput,
  UpdateDatabaseRowInput,
  ConfirmProjectPriceImportResponse,
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
const PROCUREMENT_ORDERS_MIGRATION = "supabase/migrations/20260418_add_procurement_orders.sql";
const SUPPLIER_PROJECT_PRICES_MIGRATION =
  "supabase/migrations/20260418_add_supplier_product_mapping_project_prices.sql";
const PROCUREMENT_ORDER_TABLES = new Set([
  "procurement_order_settings",
  "procurement_orders",
  "procurement_order_items",
]);

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
  supplier_discount_pct: number | null;
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
  project_prices?: unknown | null;
  min_order_qty: number | null;
  created_at: string;
}

interface DbOrder {
  id: string;
  user_id: string | null;
  project_id: string | null;
  total_price: number | null;
  status: string;
  created_at: string;
  payment_term_id: string | null;
  expected_delivery_days: number | null;
  site_name: string | null;
  ordered_by: string | null;
  notes: string | null;
  rejection_reason: string | null;
  items: unknown;
}

interface DbOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  unit_price: number;
  quantity: number;
  created_at: string;
}

interface DbProject {
  id: string;
  name: string;
  city: string | null;
  zip_code: string | null;
  address: string | null;
  min_approval: number | null;
  created_at: string;
}

const DATABASE_SCHEMAS: Record<DatabaseTableName, DatabaseTableDefinition> = {
  normalized_products: {
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
  },
  suppliers: {
    name: "suppliers",
    label: "Suppliers",
    description: "Supplier master data used for catalog matching and discount management.",
    primaryKey: "id",
    columns: [
      { name: "id", label: "ID", type: "uuid", nullable: false, editable: false },
      { name: "name", label: "Name", type: "string", nullable: false, editable: true },
      {
        name: "import_type",
        label: "Import Type",
        type: "string",
        nullable: true,
        editable: true,
      },
      {
        name: "contract_active",
        label: "Contract Active",
        type: "boolean",
        nullable: true,
        editable: true,
      },
      {
        name: "supplier_discount_pct",
        label: "Supplier Discount %",
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
  },
  projects: {
    name: "projects",
    label: "Projects",
    description:
      "Project master data used for delivery locations, approval thresholds, and special price imports.",
    primaryKey: "id",
    columns: [
      { name: "id", label: "ID", type: "uuid", nullable: false, editable: false },
      { name: "name", label: "Name", type: "string", nullable: false, editable: true },
      { name: "city", label: "City", type: "string", nullable: true, editable: true },
      { name: "zip_code", label: "ZIP Code", type: "string", nullable: true, editable: true },
      { name: "address", label: "Address", type: "string", nullable: true, editable: true },
      {
        name: "min_approval",
        label: "Min Approval",
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
  },
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

function getMissingSchemaTable(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const match = error.message.match(/Could not find the table 'public\.([^']+)' in the schema cache/);
  return match?.[1] ?? null;
}

function rethrowMissingProcurementOrderSchema(error: unknown): never {
  const missingTable = getMissingSchemaTable(error);
  if (!missingTable || !PROCUREMENT_ORDER_TABLES.has(missingTable)) {
    throw error;
  }

  throw new ApiError(
    503,
    `Orders are unavailable because the database is missing "${missingTable}". Apply ${PROCUREMENT_ORDERS_MIGRATION} to the Supabase project at ${SUPABASE_URL}.`
  );
}

function rethrowMissingSupplierProjectPriceSchema(error: unknown): never {
  const missingColumn = getMissingSchemaColumn(error, "supplier_product_mapping");
  if (missingColumn !== "project_prices") {
    throw error;
  }

  throw new ApiError(
    503,
    `Project-specific price imports are unavailable because "supplier_product_mapping.project_prices" is missing. Apply ${SUPPLIER_PROJECT_PRICES_MIGRATION} to the Supabase project at ${SUPABASE_URL}.`
  );
}

function parseProjectPrices(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [projectId, rawPrice] of Object.entries(value as Record<string, unknown>)) {
    const parsedPrice = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
    if (Number.isFinite(parsedPrice)) {
      result[projectId] = parsedPrice;
    }
  }

  return result;
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
  if (tableName in DATABASE_SCHEMAS) {
    return DATABASE_SCHEMAS[tableName as DatabaseTableName];
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
  supplier: DbSupplier,
  projectId?: string
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

  const projectPrices = parseProjectPrices(mapping.project_prices);
  const effectiveUnitPrice =
    projectId && Number.isFinite(projectPrices[projectId])
      ? projectPrices[projectId]
      : mapping.contract_price ?? 0;

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
    subcategory: product.subcategory ?? "",
    unit: product.unit ?? "",
    unitPrice: effectiveUnitPrice,
    consumptionType: product.consumption_type ?? "",
    hazardous: Boolean(product.is_hazmat ?? product.hazardous),
    storageLocation: product.storage_location ?? "",
    typicalSite: product.typical_site ?? "",
    catalogStatus: assertCatalogStatus(catalogStatus),
    isCMaterial,
    createdAt: product.created_at,
  };
}

function assertApprovalRoute(value: string): ApprovalRoute {
  if (
    value === "auto_approve" ||
    value === "project_manager" ||
    value === "central_procurement"
  ) {
    return value;
  }

  throw new ApiError(500, `Unsupported approval route "${value}".`);
}

const DEFAULT_PROCUREMENT_ORDER_SETTINGS: ProcurementOrderSettings = {
  autoApproveBelow: 200,
  centralProcurementCategories: ["Electrical", "Consumables"],
};

let procurementOrderSettingsState: ProcurementOrderSettings = {
  ...DEFAULT_PROCUREMENT_ORDER_SETTINGS,
};

function sanitizeOrderCategories(categories: unknown): NormalizedCategory[] {
  return Array.isArray(categories)
    ? categories.filter(
        (value): value is NormalizedCategory =>
          value === "Fasteners" ||
          value === "Electrical" ||
          value === "PPE" ||
          value === "Consumables" ||
          value === "Tools" ||
          value === "Site Supplies" ||
          value === "Other"
      )
    : [];
}

function normalizeOrderSettings(input: ProcurementOrderSettings): ProcurementOrderSettings {
  return {
    autoApproveBelow:
      Number.isFinite(input.autoApproveBelow) && input.autoApproveBelow >= 0
        ? input.autoApproveBelow
        : DEFAULT_PROCUREMENT_ORDER_SETTINGS.autoApproveBelow,
    centralProcurementCategories: sanitizeOrderCategories(input.centralProcurementCategories),
  };
}

async function ensureProcurementOrderSettings(): Promise<ProcurementOrderSettings> {
  return { ...procurementOrderSettingsState };
}

function coerceNormalizedCategory(value: string | null | undefined): NormalizedCategory {
  if (!value) {
    return "Other";
  }

  try {
    return assertNormalizedCategory(value);
  } catch {
    return "Other";
  }
}

function normalizeOrderStatus(value: string): ProcurementOrder["status"] {
  if (
    value === "draft" ||
    value === "pending_approval" ||
    value === "ordered" ||
    value === "delivered" ||
    value === "rejected"
  ) {
    return value;
  }

  if (value === "approved") {
    return "ordered";
  }

  if (value === "requested") {
    return "pending_approval";
  }

  return "draft";
}

function appendOrderNotes(reason: string, notes: string | null | undefined): string {
  const trimmedNotes = notes?.trim();
  if (!trimmedNotes) {
    return reason;
  }

  return `${reason} ${trimmedNotes}`;
}

function routeOrderForApproval(
  settings: ProcurementOrderSettings,
  totalAmount: number,
  categories: NormalizedCategory[],
  project: DbProject | null
): {
  status: ProcurementOrder["status"];
  route: ApprovalRoute;
  reason: string;
  approvedAt: string | null;
  submittedAt: string;
} {
  const now = new Date().toISOString();
  const requiresCentralProcurement = categories.some((category) =>
    settings.centralProcurementCategories.includes(category)
  );

  if (requiresCentralProcurement) {
    return {
      status: "pending_approval",
      route: "central_procurement",
      reason: "Contains product groups that require central procurement review.",
      approvedAt: null,
      submittedAt: now,
    };
  }

  return {
    status: "pending_approval",
    route: "project_manager",
    reason: project?.name
      ? `Sent to the project manager for approval on project "${project.name}".`
      : `Sent to the project manager for approval.`,
    approvedAt: null,
    submittedAt: now,
  };
}

function toProcurementOrder(
  order: DbOrder,
  items: DbOrderItem[],
  project: DbProject | null,
  productsById: Map<string, DbNormalizedProduct>,
  settings: ProcurementOrderSettings
): ProcurementOrder {
  const normalizedItems = items.map((item): ProcurementOrderItem => {
    const product = item.product_id ? productsById.get(item.product_id) : undefined;
    const unitPrice = item.unit_price ?? 0;
    const quantity = item.quantity ?? 0;

    return {
      id: item.id,
      productId: item.product_id ?? "",
      displayName:
        product?.product_name ?? product?.source_name ?? `Item ${item.id.slice(0, 8)}`,
      normalizedCategory: coerceNormalizedCategory(product?.category),
      unit: product?.unit ?? "",
      unitPrice,
      quantity,
      supplierName: "",
      lineTotal: unitPrice * quantity,
    };
  });

  const totalAmount =
    typeof order.total_price === "number"
      ? order.total_price
      : normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const categories = normalizedItems.map((item) => item.normalizedCategory);
  const status = normalizeOrderStatus(order.status);
  const requiresCentralProcurement = categories.some((category) =>
    settings.centralProcurementCategories.includes(category)
  );
  const routed = routeOrderForApproval(settings, totalAmount, categories, project);

  let approvalRoute: ApprovalRoute = requiresCentralProcurement
    ? "central_procurement"
    : "project_manager";
  let approvalReason = appendOrderNotes("Draft order not submitted yet.", order.notes);
  let submittedAt: string | null = null;
  let approvedAt: string | null = null;
  let orderedAt: string | null = null;
  let deliveredAt: string | null = null;

  if (status === "pending_approval") {
    approvalRoute = requiresCentralProcurement ? "central_procurement" : "project_manager";
    approvalReason = appendOrderNotes(
      requiresCentralProcurement
        ? "Contains product groups that require central procurement review."
        : "Awaiting approval.",
      order.notes
    );
    submittedAt = order.created_at;
  }

  if (status === "ordered") {
    approvalRoute = requiresCentralProcurement ? "central_procurement" : "project_manager";
    approvalReason = appendOrderNotes("Order has been placed with the supplier.", order.notes);
    submittedAt = order.created_at;
    approvedAt = order.created_at;
    orderedAt = order.created_at;
  }

  if (status === "delivered") {
    approvalRoute = requiresCentralProcurement ? "central_procurement" : "project_manager";
    approvalReason = appendOrderNotes("Order has been delivered to site.", order.notes);
    submittedAt = order.created_at;
    approvedAt = order.created_at;
    orderedAt = order.created_at;
    deliveredAt = order.created_at;
  }

  if (status === "rejected") {
    approvalRoute = requiresCentralProcurement ? "central_procurement" : "project_manager";
    approvalReason = appendOrderNotes(
      order.rejection_reason?.trim()
        ? `Order was declined. Reason: ${order.rejection_reason.trim()}`
        : "Order was declined.",
      order.notes
    );
    submittedAt = order.created_at;
  }

  return {
    id: order.id,
    projectId: order.project_id ?? null,
    projectName: project?.name ?? order.site_name?.trim() ?? "Unnamed project",
    foremanName: order.ordered_by?.trim() || "Unknown requester",
    status,
    approvalRoute,
    approvalReason,
    rejectionReason: order.rejection_reason?.trim() || null,
    totalAmount,
    currency: "CHF",
    createdAt: order.created_at,
    submittedAt,
    approvedAt,
    orderedAt,
    deliveredAt,
    items: normalizedItems,
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

function toProjectSummary(project: DbProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    city: project.city ?? null,
    zipCode: project.zip_code ?? null,
    address: project.address ?? null,
    minApproval: project.min_approval ?? null,
    createdAt: project.created_at,
  };
}

function normalizeOptionalProjectText(value: string | undefined): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

function normalizeLoose(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildDefaultProjectPriceMapping(
  columns: string[]
): ProjectPriceImportMapping[] {
  const headerAliases: Array<{
    target: ProjectPriceImportFieldTarget;
    aliases: string[];
  }> = [
    {
      target: "supplierSku",
      aliases: [
        "supplier_sku",
        "supplier sku",
        "sku",
        "artikel_id",
        "article id",
        "material number",
      ],
    },
    {
      target: "supplierName",
      aliases: ["supplier_name", "supplier name", "supplier", "vendor", "lieferant"],
    },
    {
      target: "projectPrice",
      aliases: [
        "project_price",
        "project price",
        "special_price",
        "special price",
        "price",
        "unit_price",
        "unit price",
        "net price",
      ],
    },
  ];

  return columns.map((column) => {
    const normalizedColumn = normalizeLoose(column);
    const matched = headerAliases.find((entry) =>
      entry.aliases.some((alias) => normalizeLoose(alias) === normalizedColumn)
    );

    return {
      sourceColumn: column,
      target: matched?.target ?? "ignore",
    };
  });
}

function sanitizeIncomingProjectPriceMapping(
  columns: string[],
  mapping?: ProjectPriceImportMapping[]
): ProjectPriceImportMapping[] {
  if (!mapping || mapping.length === 0) {
    return buildDefaultProjectPriceMapping(columns);
  }

  const validTargets = new Set<string>([
    "supplierSku",
    "supplierName",
    "projectPrice",
    "ignore",
  ]);

  return columns.map((column) => {
    const match = mapping.find((entry) => entry.sourceColumn === column);
    return {
      sourceColumn: column,
      target:
        match && validTargets.has(match.target)
          ? match.target
          : "ignore",
    };
  });
}

function parseImportedPrice(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Price is required.");
  }

  const european = normalized.replace(/\./g, "").replace(",", ".");
  const direct = normalized.replace(",", ".");
  const parsed = Number(normalized.includes(",") && !normalized.includes(".") ? direct : european);
  const fallback = Number(direct);
  const result = Number.isFinite(parsed) ? parsed : fallback;

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid price "${value}".`);
  }

  return result;
}

type ParsedProjectPriceImportRow = {
  rowNumber: number;
  supplierSku: string;
  supplierName: string;
  projectPrice: number | null;
  validationError: string | null;
};

type ResolvedProjectPriceImportRow = {
  rowNumber: number;
  supplierSku: string;
  supplierName: string;
  productName: string;
  currentContractPrice: number | null;
  projectPrice: number | null;
  matched: boolean;
  reason: string;
  mappingId: string | null;
};

function parseProjectPriceImportRows(
  rows: Record<string, unknown>[],
  mapping: ProjectPriceImportMapping[]
): ParsedProjectPriceImportRow[] {
  const sourceColumnByTarget = new Map<ProjectPriceImportFieldTarget, string>();

  for (const entry of mapping) {
    if (entry.target !== "ignore" && !sourceColumnByTarget.has(entry.target)) {
      sourceColumnByTarget.set(entry.target, entry.sourceColumn);
    }
  }

  return rows.map((row, index) => {
    const supplierSku = String(row[sourceColumnByTarget.get("supplierSku") ?? ""] ?? "").trim();
    const supplierName = String(row[sourceColumnByTarget.get("supplierName") ?? ""] ?? "").trim();
    const priceRaw = String(row[sourceColumnByTarget.get("projectPrice") ?? ""] ?? "").trim();

    let projectPrice: number | null = null;
    let validationError: string | null = null;

    if (!sourceColumnByTarget.get("projectPrice")) {
      validationError = "Map one column to project price.";
    } else if (!supplierSku) {
      validationError = "Map and fill supplier_sku.";
    } else if (!supplierName) {
      validationError = "Map and fill supplier_name.";
    } else if (!priceRaw) {
      validationError = "No project price column value found.";
    } else {
      try {
        projectPrice = parseImportedPrice(priceRaw);
      } catch (error) {
        validationError = error instanceof Error ? error.message : "Invalid project price.";
      }
    }

    return {
      rowNumber: index + 1,
      supplierSku,
      supplierName,
      projectPrice,
      validationError,
    };
  });
}

async function getProjectById(projectId: string): Promise<DbProject> {
  const rows = await run<DbProject[]>(db.from("projects").select("*").eq("id", projectId).limit(1));
  if (!rows[0]) {
    throw new ApiError(404, "Project not found.");
  }
  return rows[0];
}

async function findProjectByName(name: string): Promise<DbProject | null> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return null;
  }

  const rows = await run<DbProject[]>(db.from("projects").select("*").eq("name", trimmedName).limit(1));
  return rows[0] ?? null;
}

async function resolveProjectPriceImportRows(
  rows: Record<string, unknown>[],
  mapping: ProjectPriceImportMapping[]
): Promise<ResolvedProjectPriceImportRow[]> {
  const parsedRows = parseProjectPriceImportRows(rows, mapping);
  const supplierNames = Array.from(
    new Set(parsedRows.map((row) => row.supplierName).filter(Boolean))
  );
  const supplierSkus = Array.from(
    new Set(parsedRows.map((row) => row.supplierSku).filter(Boolean))
  );
  const suppliers =
    supplierNames.length > 0
      ? await run<DbSupplier[]>(db.from("suppliers").select("*").in("name", supplierNames))
      : [];
  const supplierByNormalizedName = new Map(
    suppliers.map((supplier) => [normalizeLoose(supplier.name), supplier])
  );
  const supplierIds = suppliers.map((supplier) => supplier.id);

  const mappings =
    supplierSkus.length > 0 && supplierIds.length > 0
      ? await run<DbSupplierProductMapping[]>(
          db
            .from("supplier_product_mapping")
            .select("*")
            .in("supplier_sku", supplierSkus)
            .in("supplier_id", supplierIds)
        )
      : [];
  const mappingBySupplierAndSku = new Map<string, DbSupplierProductMapping>();
  for (const mappingRow of mappings) {
    if (!mappingRow.supplier_sku) {
      continue;
    }
    mappingBySupplierAndSku.set(
      `${mappingRow.supplier_id}::${mappingRow.supplier_sku.trim()}`,
      mappingRow
    );
  }
  const productIds = Array.from(new Set(mappings.map((row) => row.product_id).filter(Boolean)));
  const products =
    productIds.length > 0
      ? await run<DbNormalizedProduct[]>(
          db.from("normalized_products").select("*").in("id", productIds)
        )
      : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  return parsedRows.map((row) => {
    if (row.validationError) {
      return {
        rowNumber: row.rowNumber,
        supplierSku: row.supplierSku,
        supplierName: row.supplierName,
        productName: "",
        currentContractPrice: null,
        projectPrice: row.projectPrice,
        matched: false,
        reason: row.validationError,
        mappingId: null,
      };
    }
    const supplier = supplierByNormalizedName.get(normalizeLoose(row.supplierName));
    if (!supplier) {
      return {
        rowNumber: row.rowNumber,
        supplierSku: row.supplierSku,
        supplierName: row.supplierName,
        productName: "",
        currentContractPrice: null,
        projectPrice: row.projectPrice,
        matched: false,
        reason: "Supplier not found.",
        mappingId: null,
      };
    }
    const mappingMatch = mappingBySupplierAndSku.get(`${supplier.id}::${row.supplierSku}`);
    if (!mappingMatch) {
      return {
        rowNumber: row.rowNumber,
        supplierSku: row.supplierSku,
        supplierName: supplier.name,
        productName: "",
        currentContractPrice: null,
        projectPrice: row.projectPrice,
        matched: false,
        reason: "Supplier SKU not found for this supplier.",
        mappingId: null,
      };
    }
    const product = productById.get(mappingMatch.product_id);

    return {
      rowNumber: row.rowNumber,
      supplierSku: mappingMatch.supplier_sku ?? row.supplierSku,
      supplierName: supplier.name,
      productName: product?.product_name ?? "",
      currentContractPrice: mappingMatch.contract_price,
      projectPrice: row.projectPrice,
      matched: true,
      reason: "Matched by supplier name and supplier SKU.",
      mappingId: mappingMatch.id,
    };
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await run<DbProject[]>(
    db.from("projects").select("*").order("name", { ascending: true })
  );

  return projects.map(toProjectSummary);
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new ApiError(400, "Project name is required.");
  }

  const existing = await run<DbProject[]>(
    db.from("projects").select("*").eq("name", trimmedName).limit(1)
  );
  if (existing[0]) {
    return toProjectSummary(existing[0]);
  }

  const projectId = randomUUID();
  const createdAt = new Date().toISOString();
  await insertWithSchemaFallback(
    "projects",
    [
      {
        id: projectId,
        name: trimmedName,
        city: normalizeOptionalProjectText(input.city),
        zip_code: normalizeOptionalProjectText(input.zipCode),
        address: normalizeOptionalProjectText(input.address),
        created_at: createdAt,
      },
    ],
    ["city", "zip_code", "address"]
  );
  const created = await run<DbProject[]>(
    db.from("projects").select("*").eq("id", projectId).limit(1)
  );

  if (!created[0]) {
    throw new ApiError(500, "Failed to create project.");
  }

  return toProjectSummary(created[0]);
}

export async function previewProjectPriceImport(input: {
  projectId: string;
  rows: Record<string, unknown>[];
  mapping?: ProjectPriceImportMapping[];
}): Promise<ProjectPriceImportPreviewResponse> {
  const project = await getProjectById(input.projectId);
  const mapping = sanitizeIncomingProjectPriceMapping(
    Object.keys(input.rows[0] ?? {}),
    input.mapping
  );
  const resolvedRows = await resolveProjectPriceImportRows(input.rows, mapping);

  return {
    project: toProjectSummary(project),
    mapping,
    totalRows: resolvedRows.length,
    matchedRows: resolvedRows.filter((row) => row.matched).length,
    unmatchedRows: resolvedRows.filter((row) => !row.matched).length,
    sampleRows: input.rows.slice(0, 5).map((row) => toStringRecord(row)),
    rows: resolvedRows.map(({ mappingId: _mappingId, matched, ...row }) => ({
      ...row,
      status: matched ? "matched" : "unmatched",
    })),
  };
}

export async function confirmProjectPriceImport(input: {
  projectId: string;
  rows: Record<string, unknown>[];
  mapping?: ProjectPriceImportMapping[];
}): Promise<ConfirmProjectPriceImportResponse> {
  const project = await getProjectById(input.projectId);
  const mapping = sanitizeIncomingProjectPriceMapping(
    Object.keys(input.rows[0] ?? {}),
    input.mapping
  );
  const resolvedRows = await resolveProjectPriceImportRows(input.rows, mapping);
  const matchedRows = resolvedRows.filter(
    (row): row is ResolvedProjectPriceImportRow & { mappingId: string; projectPrice: number } =>
      row.matched && Boolean(row.mappingId) && typeof row.projectPrice === "number"
  );

  try {
    if (matchedRows.length > 0) {
      const mappingPriceById = new Map<string, number>();
      for (const row of matchedRows) {
        mappingPriceById.set(row.mappingId, row.projectPrice);
      }

      const mappingIds = Array.from(mappingPriceById.keys());
      const mappings = await run<DbSupplierProductMapping[]>(
        db.from("supplier_product_mapping").select("*").in("id", mappingIds)
      );
      const mappingById = new Map(mappings.map((mappingRow) => [mappingRow.id, mappingRow]));

      for (const [mappingId, projectPrice] of mappingPriceById) {
        const mappingRow = mappingById.get(mappingId);
        if (!mappingRow) {
          throw new ApiError(
            409,
            "Some supplier mappings changed after the preview was generated. Refresh the preview and try again."
          );
        }

        const nextProjectPrices = parseProjectPrices(mappingRow.project_prices);
        nextProjectPrices[project.id] = projectPrice;

        await run(
          db
            .from("supplier_product_mapping")
            .update({ project_prices: nextProjectPrices })
            .eq("id", mappingId)
        );
      }
    }
  } catch (error) {
    rethrowMissingSupplierProjectPriceSchema(error);
  }

  return {
    project: toProjectSummary(project),
    importedPrices: new Set(matchedRows.map((row) => row.mappingId)).size,
    unmatchedRows: resolvedRows.length - matchedRows.length,
  };
}

export async function createCsvImportPreview(input: {
  fileName: string;
  rows: Record<string, unknown>[];
  mapping?: CsvImportMapping[];
  derivedMapping?: DerivedFieldMapping[];
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
          preview.sourceCategory
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
  requestedDerivedMapping?: DerivedFieldMapping[]
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
      preview.sourceCategory
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
  projectId?: string;
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
    return [toCatalogItem(product, mapping, supplier, filters.projectId)];
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

export async function listProcurementOrders(): Promise<ProcurementOrdersResponse> {
  const settings = await ensureProcurementOrderSettings();
  const orders = await run<DbOrder[]>(db.from("orders").select("*").order("created_at", { ascending: false }));

  if (orders.length === 0) {
    return { settings, orders: [] };
  }

  const orderIds = orders.map((order) => order.id);
  const items = await run<DbOrderItem[]>(db.from("order_items").select("*").in("order_id", orderIds));
  const itemsByOrderId = new Map<string, DbOrderItem[]>();
  for (const item of items) {
    const current = itemsByOrderId.get(item.order_id) ?? [];
    current.push(item);
    itemsByOrderId.set(item.order_id, current);
  }
  const projectIds = Array.from(
    new Set(orders.map((order) => order.project_id).filter((value): value is string => Boolean(value)))
  );
  const productIds = Array.from(
    new Set(items.map((item) => item.product_id).filter((value): value is string => Boolean(value)))
  );
  const [projects, products] = await Promise.all([
    projectIds.length > 0
      ? run<DbProject[]>(db.from("projects").select("*").in("id", projectIds))
      : Promise.resolve([] as DbProject[]),
    productIds.length > 0
      ? run<DbNormalizedProduct[]>(db.from("normalized_products").select("*").in("id", productIds))
      : Promise.resolve([] as DbNormalizedProduct[]),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const productsById = new Map(products.map((product) => [product.id, product]));

  return {
    settings,
    orders: orders.map((order) =>
      toProcurementOrder(
        order,
        itemsByOrderId.get(order.id) ?? [],
        order.project_id ? projectsById.get(order.project_id) ?? null : null,
        productsById,
        settings
      )
    ),
  };
}

export async function updateProcurementOrderSettings(
  input: ProcurementOrderSettings
): Promise<ProcurementOrderSettings> {
  procurementOrderSettingsState = normalizeOrderSettings(input);
  return { ...procurementOrderSettingsState };
}

export async function createProcurementOrder(
  input: ProcurementOrderCreateInput
): Promise<ProcurementOrder> {
  const requestedProjectId = input.projectId?.trim() ?? "";
  const requestedProjectName = input.projectName.trim();
  let project: DbProject | null = null;

  if (requestedProjectId) {
    project = await getProjectById(requestedProjectId);
  } else if (requestedProjectName) {
    project = await findProjectByName(requestedProjectName);
  }

  const projectName = project?.name ?? requestedProjectName;

  if (!projectName) {
    throw new ApiError(400, "Project name is required.");
  }

  if (!input.foremanName.trim()) {
    throw new ApiError(400, "Foreman name is required.");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ApiError(400, "Add at least one item to the order.");
  }

  const totalAmount = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const now = new Date().toISOString();
  const orderId = randomUUID();

  await insertWithSchemaFallback(
    "orders",
    [
      {
        id: orderId,
        project_id: project?.id ?? null,
        total_price: totalAmount,
        status: "draft",
        created_at: now,
        payment_term_id: null,
        expected_delivery_days: null,
        site_name: projectName,
        ordered_by: input.foremanName.trim(),
        notes: null,
        items: [],
      },
    ],
    ["project_id"]
  );
  const insertedOrders = await run<DbOrder[]>(
    db.from("orders").select("*").eq("id", orderId).limit(1)
  );

  if (!insertedOrders[0]) {
    throw new ApiError(500, "Failed to create procurement order.");
  }

  const itemRows = input.items.map((item) => ({
    id: randomUUID(),
    order_id: orderId,
    product_id: item.productId || null,
    unit_price: item.unitPrice,
    quantity: item.quantity,
    created_at: now,
  }));

  await run(db.from("order_items").insert(itemRows));

  const productIds = Array.from(
    new Set(itemRows.map((item) => item.product_id).filter((value): value is string => Boolean(value)))
  );
  const products =
    productIds.length > 0
      ? await run<DbNormalizedProduct[]>(db.from("normalized_products").select("*").in("id", productIds))
      : [];
  const productsById = new Map(products.map((product) => [product.id, product]));

  return toProcurementOrder(insertedOrders[0], itemRows, project, productsById, await ensureProcurementOrderSettings());
}

export async function updateProcurementOrderStatus(
  orderId: string,
  input: ProcurementOrderActionInput
): Promise<ProcurementOrder> {
  const orders = await run<DbOrder[]>(db.from("orders").select("*").eq("id", orderId).limit(1));
  const order = orders[0];
  if (!order) {
    throw new ApiError(404, "Procurement order not found.");
  }

  const itemRows = await run<DbOrderItem[]>(db.from("order_items").select("*").eq("order_id", orderId));
  const settings = await ensureProcurementOrderSettings();
  const productIds = Array.from(
    new Set(itemRows.map((item) => item.product_id).filter((value): value is string => Boolean(value)))
  );
  const products =
    productIds.length > 0
      ? await run<DbNormalizedProduct[]>(db.from("normalized_products").select("*").in("id", productIds))
      : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const categories = itemRows.map((item) =>
    coerceNormalizedCategory(item.product_id ? productsById.get(item.product_id)?.category : null)
  );
  const totalAmount =
    typeof order.total_price === "number"
      ? order.total_price
      : itemRows.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const project =
    order.project_id
      ? await getProjectById(order.project_id)
      : order.site_name
        ? await findProjectByName(order.site_name)
        : null;
  const patch: Partial<DbOrder> = {};
  const currentStatus = normalizeOrderStatus(order.status);
  const rejectionReason = input.rejectionReason?.trim() ?? "";

  if (input.action === "submit") {
    if (currentStatus !== "draft") {
      throw new ApiError(409, "Only draft orders can be submitted.");
    }

    const routed = routeOrderForApproval(settings, totalAmount, categories, project);
    patch.status = routed.status;
    patch.rejection_reason = null;
  }

  if (input.action === "approve") {
    if (currentStatus !== "pending_approval") {
      throw new ApiError(409, "Only pending orders can be approved.");
    }

    patch.status = "ordered";
    patch.rejection_reason = null;
  }

  if (input.action === "reject") {
    if (currentStatus !== "pending_approval") {
      throw new ApiError(409, "Only pending orders can be rejected.");
    }

    if (!rejectionReason) {
      throw new ApiError(400, "A rejection reason is required.");
    }

    patch.status = "rejected";
    patch.rejection_reason = rejectionReason;
  }

  if (input.action === "mark_ordered") {
    if (order.status !== "approved" && currentStatus !== "ordered") {
      throw new ApiError(409, "Only approved orders can be marked as ordered.");
    }

    patch.status = "ordered";
    patch.rejection_reason = null;
  }

  if (input.action === "mark_delivered") {
    if (currentStatus !== "ordered") {
      throw new ApiError(409, "Only ordered items can be marked as delivered.");
    }

    patch.status = "delivered";
    patch.rejection_reason = null;
  }

  const updatedRows = await run<DbOrder[]>(
    db.from("orders").update(patch).eq("id", orderId).select("*").limit(1)
  );

  if (!updatedRows[0]) {
    throw new ApiError(500, "The procurement order was updated but could not be reloaded.");
  }

  return toProcurementOrder(updatedRows[0], itemRows, project, productsById, settings);
}

export function listDatabaseTables(): DatabaseTableDefinition[] {
  return Object.values(DATABASE_SCHEMAS);
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
