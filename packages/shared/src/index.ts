export const NORMALIZED_CATEGORIES = [
  "Fasteners",
  "Electrical",
  "PPE",
  "Consumables",
  "Tools",
  "Site Supplies",
  "Other"
] as const;

export type NormalizedCategory = (typeof NORMALIZED_CATEGORIES)[number];

export const CATALOG_STATUSES = ["imported", "published", "excluded"] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const ORDER_STATUSES = [
  "draft",
  "pending_approval",
  "ordered",
  "delivered",
  "rejected",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const APPROVAL_ROUTES = [
  "auto_approve",
  "project_manager",
  "central_procurement",
] as const;

export type ApprovalRoute = (typeof APPROVAL_ROUTES)[number];

export const IMPORT_BATCH_STATUSES = ["draft", "confirmed"] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const CSV_IMPORT_TARGETS = [
  "supplierSku",
  "sourceName",
  "sourceCategory",
  "familyName",
  "variantLabel",
  "normalizedCategory",
  "subcategory",
  "unit",
  "unitPrice",
  "supplierName",
  "consumptionType",
  "hazardous",
  "storageLocation",
  "typicalSite",
  "catalogStatus",
  "isCMaterial",
] as const;

export type CsvImportFieldTarget = (typeof CSV_IMPORT_TARGETS)[number];

export interface CsvImportMapping {
  sourceColumn: string;
  target: CsvImportFieldTarget | "ignore";
}

export const DERIVED_IMPORT_FIELDS = [
  "familyName",
  "variantLabel",
  "variantAttributes",
  "normalizedCategory",
] as const;

export type DerivedImportField = (typeof DERIVED_IMPORT_FIELDS)[number];

export const DERIVED_FIELD_TARGETS = {
  familyName: ["family_name", "product_name", "source_name", "packaging.familyName"] as const,
  variantLabel: [
    "variant_label",
    "size",
    "product_name",
    "source_name",
    "packaging.variantLabel",
  ] as const,
  variantAttributes: ["variant_attributes", "packaging.variantAttributes"] as const,
  normalizedCategory: ["category", "subcategory", "source_category"] as const,
} as const;

export type DerivedFieldTarget =
  | (typeof DERIVED_FIELD_TARGETS.familyName)[number]
  | (typeof DERIVED_FIELD_TARGETS.variantLabel)[number]
  | (typeof DERIVED_FIELD_TARGETS.variantAttributes)[number]
  | (typeof DERIVED_FIELD_TARGETS.normalizedCategory)[number];

export interface DerivedFieldMapping {
  field: DerivedImportField;
  target: DerivedFieldTarget;
}

export const DEFAULT_DERIVED_FIELD_MAPPINGS: DerivedFieldMapping[] = [
  { field: "familyName", target: "family_name" },
  { field: "variantLabel", target: "variant_label" },
  { field: "variantAttributes", target: "variant_attributes" },
  { field: "normalizedCategory", target: "category" },
];

export interface ProductVariantAttribute {
  key: string;
  value: string;
}

export interface ImportPreviewRow {
  supplierName: string;
  supplierSku: string;
  sourceName: string;
  normalizedName: string;
  familyName: string;
  variantLabel: string;
  variantAttributes: ProductVariantAttribute[];
  sourceCategory: string;
  normalizedCategory: NormalizedCategory;
  subcategory: string;
  unit: string;
  unitPrice: number;
  consumptionType: string;
  hazardous: boolean;
  storageLocation: string;
  typicalSite: string;
  catalogStatus: CatalogStatus;
  isCMaterial: boolean;
}

export interface ImportBatchSummary {
  id: string;
  fileName: string;
  status: ImportBatchStatus;
  totalRows: number;
  supplierNames: string[];
  detectedColumns: string[];
  createdAt: string;
}

export interface CsvImportPreviewResponse {
  importBatch: ImportBatchSummary;
  mapping: CsvImportMapping[];
  derivedMapping: DerivedFieldMapping[];
  sampleRows: Record<string, string>[];
  previewRows: ImportPreviewRow[];
}

export interface ImportBatchListResponse {
  imports: ImportBatchSummary[];
}

export interface ConfirmImportResponse {
  importBatch: ImportBatchSummary;
  importedItems: number;
}

export const PROJECT_PRICE_IMPORT_TARGETS = [
  "supplierSku",
  "supplierName",
  "projectPrice",
] as const;

export type ProjectPriceImportFieldTarget =
  (typeof PROJECT_PRICE_IMPORT_TARGETS)[number];

export interface ProjectPriceImportMapping {
  sourceColumn: string;
  target: ProjectPriceImportFieldTarget | "ignore";
}

export interface ProjectSummary {
  id: string;
  name: string;
  city: string | null;
  zipCode: string | null;
  address: string | null;
  minApproval: number | null;
  createdAt: string;
}

export interface SpendAnalyticsProject {
  projectId: string;
  projectName: string;
  budgetDaily: number;
  projectStart: string; // created_at
  budgetTotal: number;
  actualSpend: number;
  remaining: number;
  percentUsed: number; // 0-100
  status: "On Track" | "Over Budget";
}

export interface SpendAnalyticsDetail {
  itemId: string;
  projectId: string;
  projectName: string;
  orderId: string;
  orderStatus: OrderStatus;
  orderedAt: string;
  supplierName: string;
  category: string;
  subcategory: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SpendAnalyticsResponse {
  projects: SpendAnalyticsProject[];
  details: SpendAnalyticsDetail[];
}

export interface ProjectsListResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectInput {
  name: string;
  city?: string;
  zipCode?: string;
  address?: string;
}

export interface ProjectPriceImportPreviewRow {
  rowNumber: number;
  supplierSku: string;
  supplierName: string;
  productName: string;
  currentContractPrice: number | null;
  projectPrice: number | null;
  status: "matched" | "unmatched";
  reason: string;
}

export interface ProjectPriceImportPreviewResponse {
  project: ProjectSummary;
  mapping: ProjectPriceImportMapping[];
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  sampleRows: Record<string, string>[];
  rows: ProjectPriceImportPreviewRow[];
}

export interface ConfirmProjectPriceImportResponse {
  project: ProjectSummary;
  importedPrices: number;
  unmatchedRows: number;
}

export interface CatalogItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  sourceName: string;
  normalizedName: string;
  familyName: string;
  variantLabel: string;
  variantAttributes: ProductVariantAttribute[];
  displayName: string;
  sourceCategory: string;
  normalizedCategory: NormalizedCategory;
  subcategory: string;
  unit: string;
  unitPrice: number;
  consumptionType: string;
  hazardous: boolean;
  storageLocation: string;
  typicalSite: string;
  catalogStatus: CatalogStatus;
  isCMaterial: boolean;
  createdAt: string;
}

export interface CatalogListResponse {
  items: CatalogItem[];
}

export interface ProcurementOrderSettings {
  autoApproveBelow: number;
  centralProcurementCategories: NormalizedCategory[];
}

export interface ProcurementOrderItemInput {
  productId: string;
  displayName: string;
  normalizedCategory: NormalizedCategory;
  unit: string;
  unitPrice: number;
  quantity: number;
  supplierName: string;
}

export interface ProcurementOrderItem extends ProcurementOrderItemInput {
  id: string;
  lineTotal: number;
}

export interface ProcurementOrder {
  id: string;
  projectId: string | null;
  projectName: string;
  foremanName: string;
  status: OrderStatus;
  approvalRoute: ApprovalRoute;
  approvalReason: string;
  rejectionReason: string | null;
  totalAmount: number;
  currency: string;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  orderedAt: string | null;
  deliveredAt: string | null;
  items: ProcurementOrderItem[];
}

export interface ProcurementOrderCreateInput {
  projectId?: string;
  projectName: string;
  foremanName: string;
  items: ProcurementOrderItemInput[];
}

export interface ProcurementOrderActionInput {
  action: "submit" | "approve" | "reject" | "mark_ordered" | "mark_delivered";
  rejectionReason?: string;
}

export interface ProcurementOrdersResponse {
  settings: ProcurementOrderSettings;
  orders: ProcurementOrder[];
}

export interface UpdateCatalogItemInput {
  displayName?: string;
  normalizedCategory?: NormalizedCategory;
  unitPrice?: number;
  isCMaterial?: boolean;
  catalogStatus?: CatalogStatus;
}

export const DATABASE_TABLES = ["normalized_products", "suppliers", "projects"] as const;

export const DEFAULT_DATABASE_TABLE = "normalized_products" as const;

export type DatabaseTableName = (typeof DATABASE_TABLES)[number];

export const DATABASE_COLUMN_KINDS = [
  "string",
  "number",
  "integer",
  "boolean",
  "json",
  "uuid",
  "datetime"
] as const;

export type DatabaseColumnKind = (typeof DATABASE_COLUMN_KINDS)[number];

export type DatabaseCellValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];

export type DatabaseRow = Record<string, DatabaseCellValue>;

export interface DatabaseColumnDefinition {
  name: string;
  label: string;
  type: DatabaseColumnKind;
  nullable: boolean;
  editable: boolean;
  description?: string;
}

export interface DatabaseTableDefinition {
  name: DatabaseTableName;
  label: string;
  description: string;
  primaryKey: string;
  columns: DatabaseColumnDefinition[];
}

export interface DatabaseTableListResponse {
  tables: DatabaseTableDefinition[];
}

export interface DatabaseTableRowsResponse {
  table: DatabaseTableDefinition;
  rows: DatabaseRow[];
  rowCount: number;
}

export interface UpdateDatabaseRowInput {
  values: Record<string, unknown>;
}

export interface ErrorResponse {
  error: string;
  details?: string[];
}
