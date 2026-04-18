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

export const IMPORT_BATCH_STATUSES = ["draft", "confirmed"] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const CSV_IMPORT_TARGETS = [
  "supplierSku",
  "sourceName",
  "sourceCategory",
  "unit",
  "unitPrice",
  "supplierName",
  "consumptionType",
  "hazardous",
  "storageLocation",
  "typicalSite"
] as const;

export type CsvImportFieldTarget = (typeof CSV_IMPORT_TARGETS)[number];

export interface CsvImportMapping {
  sourceColumn: string;
  target: CsvImportFieldTarget | "ignore";
}

export interface ImportPreviewRow {
  supplierName: string;
  supplierSku: string;
  sourceName: string;
  sourceCategory: string;
  normalizedCategory: NormalizedCategory;
  unit: string;
  unitPrice: number;
  consumptionType: string;
  hazardous: boolean;
  storageLocation: string;
  typicalSite: string;
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
  sampleRow: Record<string, string>;
  previewRows: ImportPreviewRow[];
}

export interface ImportBatchListResponse {
  imports: ImportBatchSummary[];
}

export interface ConfirmImportResponse {
  importBatch: ImportBatchSummary;
  importedItems: number;
}

export interface CatalogItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  sourceName: string;
  displayName: string;
  sourceCategory: string;
  normalizedCategory: NormalizedCategory;
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

export interface UpdateCatalogItemInput {
  displayName?: string;
  normalizedCategory?: NormalizedCategory;
  unitPrice?: number;
  isCMaterial?: boolean;
  catalogStatus?: CatalogStatus;
}

export interface ErrorResponse {
  error: string;
  details?: string[];
}
