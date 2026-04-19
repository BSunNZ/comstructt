import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
// Currency formatter for UI display (EUR)
const EUR_FORMATTER = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
import {
  APPROVAL_ROUTES,
  type ConfirmProjectPriceImportResponse,
  CSV_IMPORT_TARGETS,
  DATABASE_TABLES,
  DEFAULT_DATABASE_TABLE,
  DEFAULT_DERIVED_FIELD_MAPPINGS,
  DERIVED_FIELD_TARGETS,
  NORMALIZED_CATEGORIES,
  ORDER_STATUSES,
  PROJECT_PRICE_IMPORT_TARGETS,
  type CatalogItem,
  type CatalogListResponse,
  type ConfirmImportResponse,
  type CsvImportFieldTarget,
  type CsvImportMapping,
  type CsvImportPreviewResponse,
  type DerivedFieldMapping,
  type DerivedFieldTarget,
  type DatabaseColumnDefinition,
  type DatabaseRow,
  type DatabaseTableDefinition,
  type DatabaseTableName,
  type DatabaseTableRowsResponse,
  type ErrorResponse,
  type ImportBatchListResponse,
  type ImportBatchSummary,
  type NormalizedCategory,
  type OrderStatus,
  type ProcurementOrder,
  type ProcurementOrderSettings,
  type ProcurementOrdersResponse,
  type ProjectPriceImportFieldTarget,
  type ProjectPriceImportMapping,
  type ProjectPriceImportPreviewResponse,
  type ProjectSummary,
  type SpendAnalyticsDetail,
  type SpendAnalyticsProject,
  type SpendAnalyticsResponse,
  type UpdateCatalogItemInput,
} from "@comstruct/shared";
import { createProject, listProjects } from "./lib/projects";

// Use relative /api by default so Vite proxy handles local dev ports safely.
const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const ORDER_LAST_SEEN_STORAGE_KEY = "comstruct.orders.lastSeenAt";

type ViewKey = "imports" | "projects" | "orders" | "spendAnalytics" | "catalog" | "supplierData" | "database";

type CatalogFilterState = {
  supplier: string;
  normalizedCategory: NormalizedCategory | "all";
  subcategory: string;
};

type OrderStatusFilter = OrderStatus | "all";
type OrderProjectFilter = "all" | string;

function tokenizeSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function renderHighlightedText(value: string, terms: string[]): ReactNode {
  if (terms.length === 0) {
    return value;
  }

  const tokens = value.split(/(\s+|[.,;:/()\-]+)/);
  return tokens.map((token, index) => {
    const comparable = token.toLowerCase();
    const matches = terms.some((term) => comparable.includes(term));

    if (!matches || /^\s+$/.test(token)) {
      return <span key={`${token}-${index}`}>{token}</span>;
    }

    return (
      <strong key={`${token}-${index}`} className="catalog-highlight">
        {token}
      </strong>
    );
  });
}

function autoMapAiSubcategoryPreview(mapping: CsvImportMapping[]): CsvImportMapping[] {
  let changed = false;
  const next: CsvImportMapping[] = mapping.map((entry) => {
    if (entry.sourceColumn !== "AI Subcategory (Preview)" || entry.target !== "ignore") {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      target: "subcategory",
    };
  });

  return changed ? next : mapping;
}

function formatProjectLocation(project: Pick<ProjectSummary, "address" | "zipCode" | "city">): string | null {
  const parts: string[] = [];
  const address = project.address?.trim();
  const cityLine = [project.zipCode?.trim(), project.city?.trim()].filter(Boolean).join(" ");

  if (address) {
    parts.push(address);
  }

  if (cityLine) {
    parts.push(cityLine);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function SidebarIcon({ view }: { view: ViewKey }) {
  if (view === "imports") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v11m0 0 4-4m-4 4-4-4M5 17.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (view === "catalog") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M5 6.5A2.5 2.5 0 0 1 7.5 4H19v14.5A1.5 1.5 0 0 0 17.5 17H7.5A2.5 2.5 0 0 0 5 19.5Zm0 0V19.5M9 8h6m-6 4h8m-8 4h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (view === "projects") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (view === "orders") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 6h2l1.5 8h9.5l2-6H8M10 18a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 10 18Zm7 0a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 17 18ZM12 4v6m0 0 2.5-2.5M12 10 9.5 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (view === "spendAnalytics") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h18M3 6h10M3 18h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (view === "supplierData") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 12a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm-6.5 7.5a6.5 6.5 0 0 1 13 0M18 8h3m-1.5-1.5v3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7.5h16M4 12h16M4 16.5h10M6.5 5v14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TARGET_LABELS: Record<CsvImportFieldTarget | "ignore", string> = {
  supplierSku: "Supplier SKU",
  sourceName: "Product name",
  sourceCategory: "Source category",
  familyName: "Family name",
  variantLabel: "Variant",
  normalizedCategory: "Normalized category",
  subcategory: "Subcategory",
  unit: "Unit",
  unitPrice: "Unit price",
  supplierName: "Supplier name",
  consumptionType: "Consumption type",
  hazardous: "Hazardous",
  storageLocation: "Storage location",
  typicalSite: "Typical site",
  catalogStatus: "Catalog status",
  isCMaterial: "C-material flag",
  ignore: "Ignore",
};

const PROJECT_PRICE_TARGET_LABELS: Record<
  ProjectPriceImportFieldTarget | "ignore",
  string
> = {
  supplierSku: "Supplier SKU",
  supplierName: "Supplier name",
  projectPrice: "Project price",
  ignore: "Ignore",
};

const DERIVED_TARGET_LABELS: Record<DerivedFieldTarget, string> = {
  family_name: "family_name",
  product_name: "product_name",
  source_name: "source_name",
  size: "size",
  variant_label: "variant_label",
  variant_attributes: "variant_attributes",
  category: "category",
  subcategory: "subcategory",
  source_category: "source_category",
  "packaging.familyName": "packaging.familyName",
  "packaging.variantLabel": "packaging.variantLabel",
  "packaging.variantAttributes": "packaging.variantAttributes",
};

const DEFAULT_ORDER_SETTINGS: ProcurementOrderSettings = {
  autoApproveBelow: 200,
  centralProcurementCategories: ["Electrical", "Consumables"],
};

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  ordered: "Ordered",
  delivered: "Delivered",
  rejected: "Declined",
};

const APPROVAL_ROUTE_LABELS = {
  auto_approve: "Auto-approve",
  project_manager: "Project manager",
  central_procurement: "Central procurement",
} as const;

async function readJson<T>(response: Response): Promise<T> {
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    if (response.ok) {
      throw new Error(`Server returned an empty response (${response.status}).`);
    }
    throw new Error(`Server returned ${response.status} with an empty response body.`);
  }

  let payload: T | ErrorResponse;
  try {
    payload = JSON.parse(bodyText) as T | ErrorResponse;
  } catch {
    if (response.ok) {
      throw new Error(`Server returned invalid JSON (${response.status}).`);
    }
    throw new Error(`Server returned ${response.status}: ${bodyText.slice(0, 220)}`);
  }

  if (!response.ok) {
    const error = payload as Partial<ErrorResponse>;
    throw new Error(
      error.details && Array.isArray(error.details) && error.details.length > 0
        ? `${error.error ?? `Request failed (${response.status})`} ${error.details.join(", ")}`
        : (error.error ?? `Request failed (${response.status})`)
    );
  }

  return payload as T;
}

function serializeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function deriveDatabaseFallbackValue(column: DatabaseColumnDefinition, row: DatabaseRow): string {
  // Simple heuristics to produce useful fallback values for empty project fields
  const lc = column.name.toLowerCase();

  // Prefer other fields on the same row
  if (lc.includes("city")) {
    const addr = typeof row.address === "string" ? row.address : undefined;
    return (
      String(row.city || row.town || (addr ? addr.split(",")[1] : undefined)) ||
      `[missing ${column.label}]`
    );
  }

  if (lc.includes("zip") || lc.includes("postal")) {
    const addr = typeof row.address === "string" ? row.address : undefined;
    const addrZip = addr ? addr.match(/\b\d{4,6}\b/)?.[0] : undefined;
    return String(row.zip || row.postal_code || row.zip_code || addrZip) || `[missing ${column.label}]`;
  }

  if (lc.includes("address") || lc.includes("street")) {
    return String(row.address || row.street || row.location) || `[missing ${column.label}]`;
  }

  if (lc.includes("name") || lc.includes("project")) {
    return String(row.project_name || row.name) || `[missing ${column.label}]`;
  }

  if (column.type === "number") {
    return "0"; // recognizable numeric placeholder
  }

  // Generic recognizable placeholder
  return `[missing ${column.label}]`;
}

function getRowId(row: DatabaseRow, table: DatabaseTableDefinition): string {
  return String(row[table.primaryKey] ?? "");
}

function isLongTextColumn(column: DatabaseColumnDefinition): boolean {
  return ["raw_description", "file_url", "packaging"].includes(column.name);
}

function getCatalogUpdatePayload(
  current: CatalogItem,
  draft: CatalogItem
): UpdateCatalogItemInput | null {
  const payload: UpdateCatalogItemInput = {};

  if (draft.displayName !== current.displayName) {
    payload.displayName = draft.displayName;
  }

  if (draft.normalizedCategory !== current.normalizedCategory) {
    payload.normalizedCategory = draft.normalizedCategory;
  }

  if (draft.unitPrice !== current.unitPrice) {
    payload.unitPrice = draft.unitPrice;
  }

  if (draft.isCMaterial !== current.isCMaterial) {
    payload.isCMaterial = draft.isCMaterial;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("imports");
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [orders, setOrders] = useState<ProcurementOrder[]>([]);
  const [orderCatalogItems, setOrderCatalogItems] = useState<CatalogItem[]>([]);
  const [orderSettings, setOrderSettings] =
    useState<ProcurementOrderSettings>(DEFAULT_ORDER_SETTINGS);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CatalogItem>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [selectedProjectPriceFile, setSelectedProjectPriceFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportPreviewResponse | null>(null);
  const [projectPricePreview, setProjectPricePreview] =
    useState<ProjectPriceImportPreviewResponse | null>(null);
  const [mappingDraft, setMappingDraft] = useState<CsvImportMapping[]>([]);
  const [projectPriceMappingDraft, setProjectPriceMappingDraft] = useState<
    ProjectPriceImportMapping[]
  >([]);
  const [derivedMappingDraft, setDerivedMappingDraft] = useState<DerivedFieldMapping[]>(
    DEFAULT_DERIVED_FIELD_MAPPINGS
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedAnalyticsProjectIds, setSelectedAnalyticsProjectIds] = useState<string[]>([]);
  const [analyticsData, setAnalyticsData] = useState<SpendAnalyticsProject[]>([]);
  const [analyticsDetails, setAnalyticsDetails] = useState<SpendAnalyticsDetail[]>([]);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [analyticsSortBy, setAnalyticsSortBy] = useState<"attention" | "spend_desc" | "spend_asc" | "newest" | "oldest">("attention");
  const [analyticsSplitByProject, setAnalyticsSplitByProject] = useState(true);
  const [analyticsSearchQuery, setAnalyticsSearchQuery] = useState("");
  const [analyticsCategoryFilter, setAnalyticsCategoryFilter] = useState<string>("all");
  const [analyticsSupplierFilter, setAnalyticsSupplierFilter] = useState<string>("all");
  const [analyticsTimeFilter, setAnalyticsTimeFilter] = useState<"all" | "30d" | "90d">("all");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectCity, setNewProjectCity] = useState("");
  const [newProjectZipCode, setNewProjectZipCode] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [orderProjectId, setOrderProjectId] = useState("");
  const [orderForemanName, setOrderForemanName] = useState("Nina Keller");
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatusFilter>("pending_approval");
  const [orderProjectFilter, setOrderProjectFilter] = useState<OrderProjectFilter>("all");
  const [catalogSearchQuery, setCatalogSearchQuery] = useState("");
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectionReasonDraft, setRejectionReasonDraft] = useState("");
  const [filters, setFilters] = useState<CatalogFilterState>({
    supplier: "all",
    normalizedCategory: "all",
    subcategory: "all",
  });
  const [selectedDatabaseTable, setSelectedDatabaseTable] =
    useState<DatabaseTableName>(DEFAULT_DATABASE_TABLE);
  const [selectedTable, setSelectedTable] = useState<DatabaseTableDefinition | null>(null);
  const [databaseRows, setDatabaseRows] = useState<DatabaseRow[]>([]);
  const [databaseDrafts, setDatabaseDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [databaseRowCount, setDatabaseRowCount] = useState(0);
  const [supplierCount, setSupplierCount] = useState<number | null>(null);
  const [databaseSearchQuery, setDatabaseSearchQuery] = useState("");
  const [databaseColumnFilters, setDatabaseColumnFilters] = useState<Record<string, string[]>>({});
  const [activeDatabaseFilterColumn, setActiveDatabaseFilterColumn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isProjectSaving, setIsProjectSaving] = useState(false);
  const [isProjectPriceUploading, setIsProjectPriceUploading] = useState(false);
  const [isProjectPriceConfirming, setIsProjectPriceConfirming] = useState(false);
  const [isOrderLoading, setIsOrderLoading] = useState(false);
  const [isOrderSaving, setIsOrderSaving] = useState(false);
  const [isOrderSettingsSaving, setIsOrderSettingsSaving] = useState(false);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [isCatalogSavingAll, setIsCatalogSavingAll] = useState(false);
  const [isDatabaseLoading, setIsDatabaseLoading] = useState(false);
  const [savingDatabaseRowId, setSavingDatabaseRowId] = useState<string | null>(null);
  const [editingDatabaseCell, setEditingDatabaseCell] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [unreadOrderCount, setUnreadOrderCount] = useState(0);
  const [orderToastMessage, setOrderToastMessage] = useState<string | null>(null);
  const ordersInitializedRef = useRef(false);
  const orderToastTimeoutRef = useRef<number | null>(null);
  const previousOrderStatusesRef = useRef<Map<string, OrderStatus>>(new Map());

  // Clear transient banners when the user switches views/categories
  useEffect(() => {
    setError(null);
    setSuccess(null);
  }, [activeView]);

  useEffect(() => {
    if (activeView === "supplierData" || activeView === "database") {
      setActiveView("orders");
    }
  }, [activeView]);

  async function loadImports() {
    const response = await fetch(`${API_BASE}/imports`);
    const payload = await readJson<ImportBatchListResponse>(response);
    setImports(payload.imports);
  }

  function readStoredLastSeenOrderTs(): number | null {
    if (typeof window === "undefined") {
      return null;
    }

    const raw = window.localStorage.getItem(ORDER_LAST_SEEN_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function latestOrderTs(orderList: ProcurementOrder[]): number | null {
    if (orderList.length === 0) {
      return null;
    }

    let latest: number | null = null;
    for (const order of orderList) {
      const createdAtTs = Date.parse(order.createdAt);
      if (!Number.isFinite(createdAtTs)) {
        continue;
      }

      latest = latest == null ? createdAtTs : Math.max(latest, createdAtTs);
    }

    return latest;
  }

  function writeLastSeenOrderTs(ts: number | null): void {
    if (typeof window === "undefined" || ts == null || !Number.isFinite(ts)) {
      return;
    }

    window.localStorage.setItem(ORDER_LAST_SEEN_STORAGE_KEY, new Date(ts).toISOString());
  }

  function showOrderToast(message: string): void {
    setOrderToastMessage(message);

    if (typeof window === "undefined") {
      return;
    }

    if (orderToastTimeoutRef.current != null) {
      window.clearTimeout(orderToastTimeoutRef.current);
    }

    orderToastTimeoutRef.current = window.setTimeout(() => {
      setOrderToastMessage(null);
      orderToastTimeoutRef.current = null;
    }, 4500);
  }

  function dismissOrderToast(): void {
    setOrderToastMessage(null);

    if (typeof window !== "undefined" && orderToastTimeoutRef.current != null) {
      window.clearTimeout(orderToastTimeoutRef.current);
      orderToastTimeoutRef.current = null;
    }
  }

  function applyOrdersSnapshot(nextOrders: ProcurementOrder[], options?: { notify?: boolean }): void {
    setOrders(nextOrders);

    const notify = options?.notify ?? true;
    const latestTs = latestOrderTs(nextOrders);
    const previousStatuses = previousOrderStatusesRef.current;
    const nextStatuses = new Map<string, OrderStatus>();
    const newlyPlacedOrders = nextOrders.filter((order) => {
      nextStatuses.set(order.id, order.status);
      const previous = previousStatuses.get(order.id);
      return previous !== undefined && previous !== "ordered" && order.status === "ordered";
    });

    if (!ordersInitializedRef.current) {
      const storedTs = readStoredLastSeenOrderTs();
      if (storedTs == null) {
        writeLastSeenOrderTs(latestTs);
        setUnreadOrderCount(0);
      } else {
        const unread = nextOrders.filter((order) => {
          const ts = Date.parse(order.createdAt);
          return Number.isFinite(ts) && ts > storedTs;
        }).length;
        setUnreadOrderCount(activeView === "orders" ? 0 : unread);
      }

      ordersInitializedRef.current = true;
      previousOrderStatusesRef.current = nextStatuses;
      return;
    }

    const storedTs = readStoredLastSeenOrderTs();
    const referenceTs = storedTs ?? latestTs;
    const newOrders =
      referenceTs == null
        ? []
        : nextOrders.filter((order) => {
            const ts = Date.parse(order.createdAt);
            return Number.isFinite(ts) && ts > referenceTs;
          });

    const signalCount = newOrders.length + newlyPlacedOrders.length;

    if (activeView === "orders") {
      writeLastSeenOrderTs(latestTs);
      setUnreadOrderCount(0);
      previousOrderStatusesRef.current = nextStatuses;
      return;
    }

    if (signalCount > 0) {
      setUnreadOrderCount((current) => Math.max(current, signalCount));
      if (notify) {
        if (newlyPlacedOrders.length > 0) {
          showOrderToast(
            newlyPlacedOrders.length === 1
              ? `Order placed: ${newlyPlacedOrders[0].projectName}.`
              : `${newlyPlacedOrders.length} orders were just placed.`
          );
        } else {
          showOrderToast(
            newOrders.length === 1
              ? `New order received for ${newOrders[0].projectName}.`
              : `${newOrders.length} new orders received.`
          );
        }
      }
    }

    previousOrderStatusesRef.current = nextStatuses;
  }

  function markOrdersAsSeen(): void {
    const latestTs = latestOrderTs(orders);
    writeLastSeenOrderTs(latestTs);
    setUnreadOrderCount(0);
  }

  async function loadProjects() {
    const projectList = await listProjects();
    setProjects(projectList);
    setSelectedProjectId((current) => {
      if (current && projectList.some((project) => project.id === current)) {
        return current;
      }

      return projectList[0]?.id ?? "";
    });
    setOrderProjectId((current) => {
      if (current && projectList.some((project) => project.id === current)) {
        return current;
      }

      return projectList[0]?.id ?? "";
    });
  }

  async function loadCatalog() {
    const response = await fetch(`${API_BASE}/catalog-items`);
    const payload = await readJson<CatalogListResponse>(response);
    setCatalogItems(payload.items);
    setDrafts((currentDrafts) =>
      Object.fromEntries(
        Object.entries(currentDrafts).filter(([id]) =>
          payload.items.some((item) => item.id === id)
        )
      )
    );
  }

  async function loadOrderWorkspace() {
    setIsOrderLoading(true);

    try {
      const catalogQuery = new URLSearchParams({ catalogStatus: "published" });
      if (orderProjectId) {
        catalogQuery.set("projectId", orderProjectId);
      }

      const [ordersResponse, catalogResponse] = await Promise.all([
        fetch(`${API_BASE}/procurement-orders`),
        fetch(`${API_BASE}/catalog-items?${catalogQuery.toString()}`),
      ]);

      const ordersPayload = await readJson<ProcurementOrdersResponse>(ordersResponse);
      const catalogPayload = await readJson<CatalogListResponse>(catalogResponse);

      applyOrdersSnapshot(ordersPayload.orders, { notify: false });
      setOrderSettings(ordersPayload.settings);
      setOrderCatalogItems(catalogPayload.items);
    } finally {
      setIsOrderLoading(false);
    }
  }

  async function loadDatabaseRows(tableName: DatabaseTableName = selectedDatabaseTable) {
    setIsDatabaseLoading(true);

    try {
      const response = await fetch(`${API_BASE}/database/tables/${tableName}/rows`);
      const payload = await readJson<DatabaseTableRowsResponse>(response);
      setSelectedDatabaseTable(payload.table.name);
      setSelectedTable(payload.table);
      setDatabaseRows(payload.rows);
      setDatabaseRowCount(payload.rowCount);
      setDatabaseDrafts({});
      setDatabaseSearchQuery("");
      setDatabaseColumnFilters({});
      setActiveDatabaseFilterColumn(null);
    } finally {
      setIsDatabaseLoading(false);
    }
  }

  async function loadSpendAnalytics(projectIds?: string[]) {
    setIsAnalyticsLoading(true);
    try {
      const qs = projectIds && projectIds.length > 0 ? `?projectIds=${projectIds.join(",")}` : "";
      const res = await fetch(`${API_BASE}/analytics/spend${qs}`);
      const payload = await readJson<SpendAnalyticsResponse>(res);
      setAnalyticsData(payload.projects);
      setAnalyticsDetails(payload.details);
      // Default to all projects selected when opening analytics for the first time.
      setSelectedAnalyticsProjectIds((current) =>
        current.length === 0 ? payload.projects.map((p) => p.projectId) : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics.");
    } finally {
      setIsAnalyticsLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setError(null);

        // Load the main lists and lightweight counts in parallel so the sidebar badges
        // show on first render.
        await Promise.all([
          loadImports(),
          loadCatalog(),
          loadProjects(),
          (async () => {
            try {
              const ordersResp = await fetch(`${API_BASE}/procurement-orders`);
              const ordersPayload = await readJson<ProcurementOrdersResponse>(ordersResp);
              applyOrdersSnapshot(ordersPayload.orders, { notify: false });
            } catch {
              // Ignore order load failure here; the full workspace will load on demand.
            }

            try {
              const suppliersResp = await fetch(`${API_BASE}/database/tables/suppliers/rows`);
              const suppliersPayload = await readJson<DatabaseTableRowsResponse>(suppliersResp);
              setSupplierCount(suppliersPayload.rowCount ?? null);
            } catch {
              setSupplierCount(null);
            }
          })(),
        ]);

        // Load the currently selected database table rows (default) after counts.
        await loadDatabaseRows();
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The workspace could not be loaded."
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (filters.subcategory === "all") {
      return;
    }

    const subcategoryStillExists = catalogItems.some((item) => {
      const row = drafts[item.id] ?? item;

      return (
        (filters.supplier === "all" || item.supplierName === filters.supplier) &&
        (filters.normalizedCategory === "all" ||
          row.normalizedCategory === filters.normalizedCategory) &&
        item.subcategory === filters.subcategory
      );
    });

    if (!subcategoryStillExists) {
      setFilters((current) => ({ ...current, subcategory: "all" }));
    }
  }, [catalogItems, drafts, filters.normalizedCategory, filters.subcategory, filters.supplier]);

  useEffect(() => {
    if (activeView !== "imports" && activeView !== "projects") {
      return;
    }

    setSelectedFile(null);
    setSelectedPdfFile(null);
    setSelectedProjectPriceFile(null);
    setError(null);
    setSuccess(null);
    setPreview(null);
    setProjectPricePreview(null);
    setProjectPriceMappingDraft([]);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "orders") {
      return;
    }

    void (async () => {
      try {
        await loadOrderWorkspace();
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "The order workspace could not be loaded."
        );
      }
    })();
  }, [activeView]);

  useEffect(() => {
    if (!ordersInitializedRef.current || activeView !== "orders") {
      return;
    }

    markOrdersAsSeen();
  }, [activeView, orders]);

  useEffect(() => {
    let cancelled = false;

    const pollOrders = async () => {
      try {
        const response = await fetch(`${API_BASE}/procurement-orders`);
        const payload = await readJson<ProcurementOrdersResponse>(response);
        if (cancelled) {
          return;
        }

        applyOrdersSnapshot(payload.orders, { notify: true });
      } catch {
        // Silent poll failure; foreground workflows handle visible errors.
      }
    };

    const intervalId = window.setInterval(() => {
      void pollOrders();
    }, 5000);

    void pollOrders();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeView]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && orderToastTimeoutRef.current != null) {
        window.clearTimeout(orderToastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activeView !== "supplierData" || selectedDatabaseTable === "suppliers") {
      return;
    }

    void (async () => {
      try {
        await loadDatabaseRows("suppliers");
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Supplier data could not be loaded."
        );
      }
    })();
  }, [activeView, selectedDatabaseTable]);

  useEffect(() => {
    if (activeView !== "projects" || selectedDatabaseTable === "projects") {
      return;
    }

    void (async () => {
      try {
        await loadDatabaseRows("projects");
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Project data could not be loaded."
        );
      }
    })();
  }, [activeView, selectedDatabaseTable]);

  useEffect(() => {
    if (activeView !== "spendAnalytics") {
      return;
    }

    void loadSpendAnalytics();
  }, [activeView]);

  const supplierOptions = useMemo(
    () => Array.from(new Set(catalogItems.map((item) => item.supplierName))).sort(),
    [catalogItems]
  );
  const catalogSearchTerms = useMemo(
    () => tokenizeSearchTerms(catalogSearchQuery),
    [catalogSearchQuery]
  );

  const subcategoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogItems
            .filter((item) => {
              const row = drafts[item.id] ?? item;

              return (
                (filters.supplier === "all" || item.supplierName === filters.supplier) &&
                (filters.normalizedCategory === "all" ||
                  row.normalizedCategory === filters.normalizedCategory) &&
                item.subcategory.trim().length > 0
              );
            })
            .map((item) => item.subcategory)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [catalogItems, drafts, filters.normalizedCategory, filters.supplier]
  );

  const filteredCatalogItems = useMemo(
    () =>
      catalogItems.filter((item) => {
        const row = drafts[item.id] ?? item;

        if (filters.supplier !== "all" && item.supplierName !== filters.supplier) {
          return false;
        }

        if (
          filters.normalizedCategory !== "all" &&
          row.normalizedCategory !== filters.normalizedCategory
        ) {
          return false;
        }

        if (filters.subcategory !== "all" && item.subcategory !== filters.subcategory) {
          return false;
        }

        if (catalogSearchTerms.length > 0) {
          const haystack = [
            item.supplierName,
            item.supplierSku,
            row.displayName,
            item.sourceName,
            item.familyName,
            item.variantLabel,
            row.normalizedCategory,
            item.subcategory,
            item.consumptionType,
            item.typicalSite,
          ]
            .join(" ")
            .toLowerCase();

          if (!catalogSearchTerms.every((term) => haystack.includes(term))) {
            return false;
          }
        }

        return true;
      }),
    [catalogItems, drafts, filters, catalogSearchTerms]
  );

  const analyticsCategoryOptions = useMemo(
    () =>
      Array.from(new Set(analyticsDetails.map((detail) => detail.category).filter(Boolean))).sort(
        (left, right) => left.localeCompare(right)
      ),
    [analyticsDetails]
  );

  const analyticsSupplierOptions = useMemo(
    () =>
      Array.from(
        new Set(
          analyticsDetails.map((detail) => detail.supplierName).filter((name) => name && name !== "Unknown supplier")
        )
      ).sort((left, right) => left.localeCompare(right)),
    [analyticsDetails]
  );

  const portfolioSortedProjects = useMemo(() => {
    const visible = analyticsData.filter((project) => selectedAnalyticsProjectIds.includes(project.projectId));

    return visible.slice().sort((left, right) => {
      const leftOverspend = Math.max(0, left.actualSpend - left.budgetTotal);
      const rightOverspend = Math.max(0, right.actualSpend - right.budgetTotal);
      const leftOverBudget = leftOverspend > 0;
      const rightOverBudget = rightOverspend > 0;

      if (leftOverBudget !== rightOverBudget) {
        return leftOverBudget ? -1 : 1;
      }

      if (rightOverspend !== leftOverspend) {
        return rightOverspend - leftOverspend;
      }

      const leftOverspendPct = left.budgetTotal > 0 ? leftOverspend / left.budgetTotal : 0;
      const rightOverspendPct = right.budgetTotal > 0 ? rightOverspend / right.budgetTotal : 0;
      if (rightOverspendPct !== leftOverspendPct) {
        return rightOverspendPct - leftOverspendPct;
      }

      if (right.actualSpend !== left.actualSpend) {
        return right.actualSpend - left.actualSpend;
      }

      return right.budgetTotal - left.budgetTotal;
    });
  }, [analyticsData, selectedAnalyticsProjectIds]);

  const filteredAnalyticsDetails = useMemo(() => {
    const searchTerms = tokenizeSearchTerms(analyticsSearchQuery);
    const now = Date.now();
    const windowMs =
      analyticsTimeFilter === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : analyticsTimeFilter === "90d"
          ? 90 * 24 * 60 * 60 * 1000
          : null;

    return analyticsDetails.filter((entry) => {
      if (!selectedAnalyticsProjectIds.includes(entry.projectId)) {
        return false;
      }

      if (analyticsCategoryFilter !== "all" && entry.category !== analyticsCategoryFilter) {
        return false;
      }

      if (analyticsSupplierFilter !== "all" && entry.supplierName !== analyticsSupplierFilter) {
        return false;
      }

      if (windowMs != null) {
        const orderedAtMs = Date.parse(entry.orderedAt);
        if (!Number.isFinite(orderedAtMs) || now - orderedAtMs > windowMs) {
          return false;
        }
      }

      if (searchTerms.length === 0) {
        return true;
      }

      const haystack = [
        entry.projectName,
        entry.orderId,
        entry.orderStatus,
        entry.supplierName,
        entry.category,
        entry.subcategory ?? "",
        entry.itemName,
      ]
        .join(" ")
        .toLowerCase();

      return searchTerms.every((term) => haystack.includes(term));
    });
  }, [
    analyticsCategoryFilter,
    analyticsDetails,
    analyticsSearchQuery,
    analyticsSupplierFilter,
    analyticsTimeFilter,
    selectedAnalyticsProjectIds,
  ]);

  const buildAnalyticsRows = (
    entries: SpendAnalyticsDetail[],
    groupBy: "order" | "category" | "supplier" | "status"
  ) => {
    const grouped = new Map<
      string,
      { label: string; total: number; latestOrderAt: number; entries: SpendAnalyticsDetail[] }
    >();

    for (const entry of entries) {
      const key =
        groupBy === "order"
          ? entry.orderId
          : groupBy === "category"
            ? entry.category
            : groupBy === "supplier"
              ? entry.supplierName
              : entry.orderStatus;
      const label =
        groupBy === "order"
          ? `${entry.orderId.slice(0, 8)} · ${entry.orderStatus}`
          : groupBy === "category"
            ? entry.category
            : groupBy === "supplier"
              ? entry.supplierName
              : entry.orderStatus.replace("_", " ");
      const current = grouped.get(key);
      const orderAtMs = Date.parse(entry.orderedAt);

      if (current) {
        current.total += entry.lineTotal;
        current.latestOrderAt = Math.max(current.latestOrderAt, Number.isFinite(orderAtMs) ? orderAtMs : 0);
        current.entries.push(entry);
      } else {
        grouped.set(key, {
          label,
          total: entry.lineTotal,
          latestOrderAt: Number.isFinite(orderAtMs) ? orderAtMs : 0,
          entries: [entry],
        });
      }
    }

    const rows = Array.from(grouped.entries()).map(([key, value]) => ({ key, ...value }));
    rows.sort((left, right) => {
      if (analyticsSortBy === "spend_asc") {
        return left.total - right.total;
      }

      if (analyticsSortBy === "newest") {
        return right.latestOrderAt - left.latestOrderAt;
      }

      if (analyticsSortBy === "oldest") {
        return left.latestOrderAt - right.latestOrderAt;
      }

      if (analyticsSortBy === "attention") {
        const leftRejected = left.entries.some((entry) => entry.orderStatus === "rejected");
        const rightRejected = right.entries.some((entry) => entry.orderStatus === "rejected");
        if (leftRejected !== rightRejected) {
          return rightRejected ? 1 : -1;
        }
      }

      return right.total - left.total;
    });

    return rows;
  };

  const analyticsProjectOrderGroups = useMemo(() => {
    return portfolioSortedProjects.map((project) => {
      const projectEntries = filteredAnalyticsDetails.filter((entry) => entry.projectId === project.projectId);
      const orderRows = buildAnalyticsRows(projectEntries, "order");
      const orders = orderRows.map((row) => ({
        ...row,
        status: row.entries[0]?.orderStatus ?? "draft",
      }));

      return {
        project,
        orders,
      };
    });
  }, [analyticsSortBy, filteredAnalyticsDetails, portfolioSortedProjects]);

  const analyticsPortfolioRows = useMemo(
    () => buildAnalyticsRows(filteredAnalyticsDetails, "category"),
    [analyticsSortBy, filteredAnalyticsDetails]
  );

  const pendingCatalogSaves = useMemo(
    () =>
      catalogItems.flatMap((item) => {
        const draft = drafts[item.id];

        if (!draft) {
          return [];
        }

        const payload = getCatalogUpdatePayload(item, draft);

        if (!payload) {
          return [];
        }

        return [{ id: item.id, displayName: draft.displayName, payload }];
      }),
    [catalogItems, drafts]
  );

  const selectedOrderProject = useMemo(
    () => projects.find((project) => project.id === orderProjectId) ?? null,
    [orderProjectId, projects]
  );

  useEffect(() => {
    setProjectPricePreview(null);
    setProjectPriceMappingDraft([]);
  }, [selectedProjectPriceFile, selectedProjectId]);

  const selectedOrderItems = useMemo(
    () =>
      orderCatalogItems
        .filter((item) => (orderQuantities[item.id] ?? 0) > 0)
        .map((item) => ({
          ...item,
          quantity: orderQuantities[item.id] ?? 0,
          lineTotal: (orderQuantities[item.id] ?? 0) * item.unitPrice,
        })),
    [orderCatalogItems, orderQuantities]
  );

  const orderDraftTotal = useMemo(
    () => selectedOrderItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [selectedOrderItems]
  );

  const orderProjectOptions = useMemo(() => {
    const seen = new Set<string>();

    return orders
      .map((order) => ({
        value: order.projectId?.trim()
          ? `id:${order.projectId.trim()}`
          : `name:${order.projectName.trim().toLowerCase()}`,
        label: order.projectName,
      }))
      .filter((option) => {
        if (seen.has(option.value)) {
          return false;
        }

        seen.add(option.value);
        return true;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [orders]);

  const projectFilteredOrders = useMemo(
    () =>
      orderProjectFilter === "all"
        ? orders
        : orders.filter((order) =>
            order.projectId?.trim()
              ? `id:${order.projectId.trim()}` === orderProjectFilter
              : `name:${order.projectName.trim().toLowerCase()}` === orderProjectFilter
          ),
    [orderProjectFilter, orders]
  );

  const orderStatusCounts = useMemo(
    () =>
      ORDER_STATUSES.reduce<Record<OrderStatus, number>>(
        (accumulator, status) => ({
          ...accumulator,
          [status]: projectFilteredOrders.filter((order) => order.status === status).length,
        }),
        {
          draft: 0,
          pending_approval: 0,
          ordered: 0,
          delivered: 0,
          rejected: 0,
        }
      ),
    [projectFilteredOrders]
  );

  const filteredOrders = useMemo(
    () => {
      const base =
        orderStatusFilter === "all"
          ? projectFilteredOrders
          : projectFilteredOrders.filter((order) => order.status === orderStatusFilter);

      return base.slice().sort((left, right) => {
        const leftTs = Date.parse(left.orderedAt ?? left.createdAt);
        const rightTs = Date.parse(right.orderedAt ?? right.createdAt);
        const leftSafe = Number.isFinite(leftTs) ? leftTs : 0;
        const rightSafe = Number.isFinite(rightTs) ? rightTs : 0;
        return rightSafe - leftSafe;
      });
    },
    [orderStatusFilter, projectFilteredOrders]
  );

  useEffect(() => {
    if (
      orderProjectFilter !== "all" &&
      !orderProjectOptions.some((option) => option.value === orderProjectFilter)
    ) {
      setOrderProjectFilter("all");
    }
  }, [orderProjectFilter, orderProjectOptions]);

  const filteredProjectRows = databaseRows;

  const databaseDraftCount = useMemo(
    () => Object.keys(databaseDrafts).length,
    [databaseDrafts]
  );

  const activeDatabaseColumnFilterCount = useMemo(
    () =>
      Object.values(databaseColumnFilters).filter((values) => values.length > 0).length,
    [databaseColumnFilters]
  );

  const visibleDatabaseColumns = useMemo(() => {
    if (!selectedTable) {
      return [] as DatabaseColumnDefinition[];
    }

    if (activeView === "supplierData" && selectedDatabaseTable === "suppliers") {
      return selectedTable.columns.filter(
        (column) => !["id", "import_type", "created_at"].includes(column.name)
      );
    }

    if (activeView === "projects" && selectedDatabaseTable === "projects") {
      return selectedTable.columns.filter(
        (column) => !["id", "created_at"].includes(column.name)
      );
    }

    return selectedTable.columns;
  }, [activeView, selectedDatabaseTable, selectedTable]);

  const databaseColumnFilterOptions = useMemo(() => {
    if (visibleDatabaseColumns.length === 0) {
      return {} as Record<string, string[]>;
    }

    return Object.fromEntries(
      visibleDatabaseColumns.map((column) => {
        const options = Array.from(
          new Set(databaseRows.map((row) => serializeCellValue(row[column.name]) || "null"))
        ).sort((left, right) => left.localeCompare(right));

        return [column.name, options];
      })
    ) as Record<string, string[]>;
  }, [databaseRows, visibleDatabaseColumns]);

  const filteredDatabaseRows = useMemo(() => {
    if (!selectedTable || visibleDatabaseColumns.length === 0) {
      return databaseRows;
    }

    const normalizedSearch = databaseSearchQuery.trim().toLowerCase();

    return databaseRows.filter((row) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        visibleDatabaseColumns.some((column) =>
          serializeCellValue(row[column.name]).toLowerCase().includes(normalizedSearch)
        );

      if (!matchesSearch) {
        return false;
      }

      return visibleDatabaseColumns.every((column) => {
        const selectedValues = databaseColumnFilters[column.name] ?? [];
        if (selectedValues.length === 0) {
          return true;
        }

        const cellValue = serializeCellValue(row[column.name]) || "null";
        return selectedValues.includes(cellValue);
      });
    });
  }, [databaseColumnFilters, databaseRows, databaseSearchQuery, selectedTable, visibleDatabaseColumns]);

  async function uploadCsv(mapping?: CsvImportMapping[]) {
    if (!selectedFile) {
      setError("Select a CSV file first.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    if (mapping) {
      formData.append("mapping", JSON.stringify(mapping));
    }

    formData.append("derivedMapping", JSON.stringify(derivedMappingDraft));

    try {
      const response = await fetch(`${API_BASE}/imports/csv`, {
        method: "POST",
        body: formData,
      });

      const payload = await readJson<CsvImportPreviewResponse>(response);
      const nextMapping = mapping ? payload.mapping : autoMapAiSubcategoryPreview(payload.mapping);
      setPreview(payload);
      setMappingDraft(nextMapping);
      setDerivedMappingDraft(payload.derivedMapping);
      setSuccess("Import preview created. Review the mapping and sample rows.");
      await loadImports();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The CSV import preview failed."
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadPdf(mapping?: CsvImportMapping[]) {
    if (!selectedPdfFile) {
      setError("Select a PDF file first.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedPdfFile);

    if (mapping) {
      formData.append("mapping", JSON.stringify(mapping));
    }

    formData.append("derivedMapping", JSON.stringify(derivedMappingDraft));

    try {
      const response = await fetch(`${API_BASE}/imports/pdf`, {
        method: "POST",
        body: formData,
      });

      const payload = await readJson<CsvImportPreviewResponse>(response);
      const nextMapping = mapping ? payload.mapping : autoMapAiSubcategoryPreview(payload.mapping);
      setPreview(payload);
      setMappingDraft(nextMapping);
      setDerivedMappingDraft(payload.derivedMapping);
      setSuccess("PDF preview created. Review the mapping and sample rows.");
      await loadImports();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The PDF import preview failed."
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function confirmCurrentImport() {
    if (!preview) {
      return;
    }

    setIsConfirming(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/imports/${preview.importBatch.id}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mapping: mappingDraft,
          derivedMapping: derivedMappingDraft,
        }),
      });

      const payload = await readJson<ConfirmImportResponse>(response);
      setSuccess(`${payload.importedItems} products were imported into the catalog.`);
      setPreview(null);
      setMappingDraft([]);
      setDerivedMappingDraft(DEFAULT_DERIVED_FIELD_MAPPINGS);
      setSelectedFile(null);
      setActiveView("catalog");
      await Promise.all([loadImports(), loadCatalog(), loadDatabaseRows()]);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : "The import could not be confirmed."
      );
    } finally {
      setIsConfirming(false);
    }
  }

  async function saveProject() {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) {
      setError("Enter a project name first.");
      return;
    }

    setIsProjectSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const project = await createProject({
        name: trimmedName,
        city: newProjectCity.trim(),
        zipCode: newProjectZipCode.trim(),
        address: newProjectAddress.trim(),
      });
      await loadProjects();
      if (activeView === "projects" || selectedDatabaseTable === "projects") {
        await loadDatabaseRows("projects");
      }
      setSelectedProjectId(project.id);
      setOrderProjectId(project.id);
      setNewProjectName("");
      setNewProjectCity("");
      setNewProjectZipCode("");
      setNewProjectAddress("");
      setSuccess(`Project "${project.name}" is ready for pricing imports and approvals.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The project could not be created.");
    } finally {
      setIsProjectSaving(false);
    }
  }

  async function previewProjectPrices(mapping?: ProjectPriceImportMapping[]) {
    if (!selectedProjectPriceFile) {
      setError("Select a CSV file first.");
      return;
    }

    if (!selectedProjectId) {
      setError("Choose a project first.");
      return;
    }

    setIsProjectPriceUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedProjectPriceFile);
    formData.append("projectId", selectedProjectId);
    if (mapping) {
      formData.append("mapping", JSON.stringify(mapping));
    }

    try {
      const response = await fetch(`${API_BASE}/project-price-imports/csv`, {
        method: "POST",
        body: formData,
      });

      const payload = await readJson<ProjectPriceImportPreviewResponse>(response);
      setProjectPricePreview(payload);
      setProjectPriceMappingDraft(payload.mapping);
      setSuccess(
        `${payload.matchedRows} rows matched for project "${payload.project.name}".`
      );
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "The project price preview could not be created."
      );
    } finally {
      setIsProjectPriceUploading(false);
    }
  }

  async function confirmProjectPrices() {
    if (!selectedProjectPriceFile || !selectedProjectId || !projectPricePreview) {
      return;
    }

    setIsProjectPriceConfirming(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedProjectPriceFile);
    formData.append("projectId", selectedProjectId);
    formData.append("mapping", JSON.stringify(projectPriceMappingDraft));

    try {
      const response = await fetch(`${API_BASE}/project-price-imports/confirm`, {
        method: "POST",
        body: formData,
      });

      const payload = await readJson<ConfirmProjectPriceImportResponse>(response);
      setSuccess(
        `${payload.importedPrices} project-specific prices were imported for "${payload.project.name}".`
      );
      setProjectPricePreview(null);
      setSelectedProjectPriceFile(null);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : "The project-specific prices could not be imported."
      );
    } finally {
      setIsProjectPriceConfirming(false);
    }
  }

  function updateOrderQuantity(itemId: string, quantity: number) {
    setOrderQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) {
        delete next[itemId];
      } else {
        next[itemId] = quantity;
      }
      return next;
    });
  }

  async function saveOrderSettings() {
    setIsOrderSettingsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/procurement-order-settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderSettings),
      });

      const payload = await readJson<ProcurementOrderSettings>(response);
      setOrderSettings(payload);
      setSuccess("Approval settings updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The approval settings could not be saved."
      );
    } finally {
      setIsOrderSettingsSaving(false);
    }
  }

  async function createOrder(submitAfterCreate: boolean) {
    if (!selectedOrderProject) {
      setError("Choose a managed project first.");
      return;
    }

    if (selectedOrderItems.length === 0) {
      setError("Add at least one published item to the draft order.");
      return;
    }

    setIsOrderSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/procurement-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: selectedOrderProject.id,
          projectName: selectedOrderProject.name,
          foremanName: orderForemanName,
          items: selectedOrderItems.map((item) => ({
            productId: item.id,
            displayName: item.displayName,
            normalizedCategory: item.normalizedCategory,
            unit: item.unit,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            supplierName: item.supplierName,
          })),
        }),
      });

      const createdOrder = await readJson<ProcurementOrder>(response);
      let finalOrder = createdOrder;

      if (submitAfterCreate) {
        const submitResponse = await fetch(`${API_BASE}/procurement-orders/${createdOrder.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "submit" }),
        });

        finalOrder = await readJson<ProcurementOrder>(submitResponse);
      }

      setOrders((current) => [finalOrder, ...current]);
      setOrderQuantities({});
      setSuccess(
        submitAfterCreate
          ? `Order routed as ${APPROVAL_ROUTE_LABELS[finalOrder.approvalRoute]}.`
          : "Draft order created."
      );
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "The order could not be created."
      );
    } finally {
      setIsOrderSaving(false);
    }
  }

  async function updateOrderStatus(
    orderId: string,
    action: "submit" | "approve" | "reject" | "mark_ordered" | "mark_delivered",
    options?: {
      rejectionReason?: string;
    }
  ) {
    setSavingOrderId(orderId);
    setError(null);
    setSuccess(null);

    try {
      const payload =
        options?.rejectionReason !== undefined
          ? { action, rejectionReason: options.rejectionReason }
          : { action };
      const response = await fetch(`${API_BASE}/procurement-orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const updated = await readJson<ProcurementOrder>(response);
      setOrders((current) => current.map((order) => (order.id === orderId ? updated : order)));
      setRejectingOrderId((current) => (current === orderId ? null : current));
      setRejectionReasonDraft("");
      setSuccess(
        action === "approve"
          ? "Order approved and automatically ordered."
          : `Order moved to ${ORDER_STATUS_LABELS[updated.status]}.`
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "The order status could not be updated."
      );
    } finally {
      setSavingOrderId(null);
    }
  }

  function startRejectingOrder(orderId: string) {
    setError(null);
    setSuccess(null);
    setRejectingOrderId((current) => (current === orderId ? null : orderId));
    setRejectionReasonDraft("");
  }

  async function submitOrderRejection(orderId: string) {
    const reason = rejectionReasonDraft.trim();
    if (!reason) {
      setError("A rejection reason is required.");
      return;
    }

    await updateOrderStatus(orderId, "reject", { rejectionReason: reason });
  }

  function updateDraftValue<K extends keyof CatalogItem>(
    id: string,
    key: K,
    value: CatalogItem[K]
  ) {
    setDrafts((currentDrafts) => {
      const base = currentDrafts[id] ?? catalogItems.find((item) => item.id === id);

      if (!base) {
        return currentDrafts;
      }

      return {
        ...currentDrafts,
        [id]: {
          ...base,
          [key]: value,
        },
      };
    });
  }

  function updateDerivedMapping(field: DerivedFieldMapping["field"], target: DerivedFieldTarget) {
    setDerivedMappingDraft((current) =>
      current.map((entry) => (entry.field === field ? { ...entry, target } : entry))
    );
  }

  async function saveCatalogTable() {
    if (pendingCatalogSaves.length === 0) {
      return;
    }

    setIsCatalogSavingAll(true);
    setError(null);
    setSuccess(null);

    try {
      const results = await Promise.allSettled(
        pendingCatalogSaves.map(async ({ id, payload }) => {
          const response = await fetch(`${API_BASE}/catalog-items/${id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const updated = await readJson<CatalogItem>(response);
          return { id, updated };
        })
      );

      const successfulUpdates: Array<{ id: string; updated: CatalogItem }> = [];
      const failedUpdates: string[] = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          successfulUpdates.push(result.value);
          return;
        }

        failedUpdates.push(pendingCatalogSaves[index].displayName);
      });

      if (successfulUpdates.length > 0) {
        const updatedById = new Map(successfulUpdates.map(({ updated }) => [updated.id, updated]));

        setCatalogItems((items) => items.map((item) => updatedById.get(item.id) ?? item));
        setDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };

          successfulUpdates.forEach(({ id }) => {
            delete nextDrafts[id];
          });

          return nextDrafts;
        });
        setSuccess(
          successfulUpdates.length === 1
            ? `"${successfulUpdates[0].updated.displayName}" was updated.`
            : `${successfulUpdates.length} catalog rows were updated.`
        );
      }

      if (failedUpdates.length > 0) {
        setError(
          failedUpdates.length === 1
            ? `The catalog row "${failedUpdates[0]}" could not be saved.`
            : `${failedUpdates.length} catalog rows could not be saved.`
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The catalog table could not be saved."
      );
    } finally {
      setIsCatalogSavingAll(false);
    }
  }

  function updateDatabaseDraft(rowId: string, columnName: string, value: unknown) {
    setDatabaseDrafts((currentDrafts) => ({
      ...currentDrafts,
      [rowId]: {
        ...(currentDrafts[rowId] ?? {}),
        [columnName]: value,
      },
    }));
  }

  function setDatabaseColumnFilter(columnName: string, values: string[]) {
    setDatabaseColumnFilters((currentFilters) => ({
      ...currentFilters,
      [columnName]: values,
    }));
  }

  function toggleDatabaseFilterColumn(columnName: string) {
    setActiveDatabaseFilterColumn((current) => (current === columnName ? null : columnName));
  }

  function toggleDatabaseFilterValue(columnName: string, value: string) {
    const currentValues = databaseColumnFilters[columnName] ?? [];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((entry) => entry !== value)
      : [...currentValues, value];

    setDatabaseColumnFilter(columnName, nextValues);
  }

  function clearSingleDatabaseFilter(columnName: string) {
    setDatabaseColumnFilters((currentFilters) => {
      const nextFilters = { ...currentFilters };
      delete nextFilters[columnName];
      return nextFilters;
    });
  }

  function clearDatabaseFilters() {
    setDatabaseSearchQuery("");
    setDatabaseColumnFilters({});
    setActiveDatabaseFilterColumn(null);
  }

  function discardDatabaseDraft(rowId: string) {
    setDatabaseDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[rowId];
      return nextDrafts;
    });
  }

  function getDatabaseValue(
    rowId: string,
    columnName: string,
    fallbackValue: unknown
  ): unknown {
    const draft = databaseDrafts[rowId];
    if (draft && columnName in draft) {
      return draft[columnName];
    }

    return fallbackValue;
  }

  async function saveDatabaseRow(rowId: string) {
    if (!selectedTable) {
      return;
    }

    const values = databaseDrafts[rowId];
    if (!values || Object.keys(values).length === 0) {
      return;
    }

    setSavingDatabaseRowId(rowId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `${API_BASE}/database/tables/${selectedDatabaseTable}/rows/${rowId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values }),
        }
      );

      const updated = await readJson<DatabaseRow>(response);
      setDatabaseRows((rows) =>
        rows.map((row) => (getRowId(row, selectedTable) === rowId ? updated : row))
      );
      if (selectedDatabaseTable === "projects") {
        await loadProjects();
      }
      discardDatabaseDraft(rowId);
      setSuccess(`${selectedTable.label} row ${rowId.slice(0, 8)} was updated.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The database row could not be saved."
      );
    } finally {
      setSavingDatabaseRowId(null);
    }
  }

  async function saveAllDatabaseDrafts() {
    if (!selectedTable) return;
    const rowIds = Object.keys(databaseDrafts);
    if (rowIds.length === 0) return;

    setIsSavingAll(true);
    setError(null);
    setSuccess(null);

    let successfullySaved = 0;
    try {
      for (const rowId of rowIds) {
        setSavingDatabaseRowId(rowId);
        const values = databaseDrafts[rowId];
        if (!values || Object.keys(values).length === 0) continue;

        const response = await fetch(
          `${API_BASE}/database/tables/${selectedDatabaseTable}/rows/${rowId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values }),
          }
        );

        const updated = await readJson<DatabaseRow>(response);
        setDatabaseRows((rows) =>
          rows.map((row) => (getRowId(row, selectedTable!) === rowId ? updated : row))
        );
        discardDatabaseDraft(rowId);
        successfullySaved++;
      }
      if (selectedDatabaseTable === "projects") {
        await loadProjects();
      }
      setSuccess(`Successfully saved ${successfullySaved} changes.`);
      setEditingDatabaseCell(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Not all database rows could be saved."
      );
    } finally {
      setSavingDatabaseRowId(null);
      setIsSavingAll(false);
    }
  }

  function renderDatabaseEditor(
    column: DatabaseColumnDefinition,
    rowId: string,
    value: unknown
  ) {
    if (column.type === "boolean") {
      return (
        <label className="checkbox" key={column.name}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => updateDatabaseDraft(rowId, column.name, event.target.checked)}
          />
          <span>{Boolean(value) ? "True" : "False"}</span>
        </label>
      );
    }

    if (column.type === "number" || column.type === "integer") {
      return (
        <input
          key={column.name}
          type="number"
          step={column.type === "integer" ? 1 : 0.01}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) =>
            updateDatabaseDraft(
              rowId,
              column.name,
              event.target.value === "" ? null : Number(event.target.value)
            )
          }
          autoFocus
          onBlur={() => setEditingDatabaseCell(null)}
        />
      );
    }

    if (column.type === "json" || isLongTextColumn(column)) {
      return (
        <textarea
          key={column.name}
          className="cell-textarea"
          value={serializeCellValue(value)}
          onChange={(event) => updateDatabaseDraft(rowId, column.name, event.target.value)}
          autoFocus
          onBlur={() => setEditingDatabaseCell(null)}
        />
      );
    }

    return (
      <input
        key={column.name}
        value={serializeCellValue(value)}
        onChange={(event) => updateDatabaseDraft(rowId, column.name, event.target.value)}
        autoFocus
        onBlur={() => setEditingDatabaseCell(null)}
      />
    );
  }

  function renderDatabaseColumnFilterMenu(column: DatabaseColumnDefinition) {
    const options = databaseColumnFilterOptions[column.name] ?? [];
    const selectedValues = databaseColumnFilters[column.name] ?? [];
    const isOpen = activeDatabaseFilterColumn === column.name;

    return (
      <div className="database-filter-wrap">
        <button
          type="button"
          className={selectedValues.length > 0 ? "filter-trigger active" : "filter-trigger"}
          onClick={() => toggleDatabaseFilterColumn(column.name)}
        >
          Filter
          {selectedValues.length > 0 ? <span>{selectedValues.length}</span> : null}
        </button>

        {isOpen ? (
          <div className="database-filter-menu">
            <div className="database-filter-menu-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => clearSingleDatabaseFilter(column.name)}
              >
                Clear
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setActiveDatabaseFilterColumn(null)}
              >
                Done
              </button>
            </div>

            <div className="database-filter-list">
              {options.map((option) => (
                <label className="database-filter-option" key={`${column.name}-${option}`}>
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option)}
                    onChange={() => toggleDatabaseFilterValue(column.name, option)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderDataWorkspace(options: {
    controlsEyebrow: string;
    controlsTitle: string;
    rowsEyebrow: string;
    rowsTitle: string;
    summaryDescription: string;
    summaryTags: string[];
    searchPlaceholder: string;
    showTableSelector: boolean;
    hideControlsPanel?: boolean;
    showWorkspaceHeader?: boolean;
    showTableSummary?: boolean;
    showWorkspaceSummary?: boolean;
    useBulkSave?: boolean;
  }) {
    const showWorkspaceHeader = options.showWorkspaceHeader ?? true;
    const showTableSummary = options.showTableSummary ?? true;
    const showWorkspaceSummary = options.showWorkspaceSummary ?? true;
    const useBulkSave = options.useBulkSave ?? false;

    function renderWorkspaceHeader() {
      if (!showWorkspaceHeader) {
        return null;
      }

      return (
        <div className="panel-header">
          <div>
            <p className="panel-eyebrow">{options.controlsEyebrow}</p>
            <h3>{options.controlsTitle}</h3>
          </div>
        </div>
      );
    }

    function renderTableSummary() {
      if (!selectedTable || !showTableSummary) {
        return null;
      }

      return (
        <div className="database-summary">
          <p>{selectedTable.description}</p>
          {!(activeView === "supplierData" || activeView === "database") ? (
            <div className="database-summary-meta">
              <span>Supabase table: {selectedDatabaseTable}</span>
              <span>Primary key: {selectedTable.primaryKey}</span>
              <span>
                Editable columns: {visibleDatabaseColumns.filter((column) => column.editable).length}
              </span>
            </div>
          ) : null}
        </div>
      );
    }

    function renderWorkspaceControls() {
      if (!selectedTable) {
        return null;
      }

      return (
        <section className="database-controls with-gap">
          {options.showTableSelector ? (
            <label className="field compact">
              <span>Table</span>
              <select
                value={selectedDatabaseTable}
                onChange={(event) => void loadDatabaseRows(event.target.value as DatabaseTableName)}
              >
                {DATABASE_TABLES.map((tableName) => (
                  <option key={tableName} value={tableName}>
                    {tableName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="field database-search-field">
            <span>Search all columns</span>
            <input
              value={databaseSearchQuery}
              onChange={(event) => setDatabaseSearchQuery(event.target.value)}
              placeholder={options.searchPlaceholder}
            />
          </label>

          <div className="database-controls-meta">
            <span className="database-chip">Rows loaded: {databaseRowCount}</span>
            <span className="database-chip">Rows visible: {filteredDatabaseRows.length}</span>
            <span className="database-chip">
              {activeDatabaseColumnFilterCount} column filters active
            </span>
            <button
              type="button"
              className="button-secondary"
              onClick={clearDatabaseFilters}
              disabled={
                databaseSearchQuery.trim().length === 0 && activeDatabaseColumnFilterCount === 0
              }
            >
              Clear filters
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={() => void loadDatabaseRows()}
            >
              Refresh
            </button>
            {useBulkSave ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void saveAllDatabaseDrafts()}
                disabled={isSavingAll || databaseDraftCount === 0}
              >
                {isSavingAll ? "Saving..." : `Save ${databaseDraftCount} changes`}
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    function renderWorkspaceSummary() {
      if (!showWorkspaceSummary) {
        return null;
      }

      return (
        <section className="database-summary with-gap">
          <p>{options.summaryDescription}</p>
          <div className="database-summary-meta">
            {options.summaryTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      );
    }

    return (
      <section className="catalog-layout">
        {!options.hideControlsPanel && (
          <article className="panel filter-panel">
            {renderWorkspaceHeader()}
            {renderTableSummary()}
            {renderWorkspaceControls()}
            {renderWorkspaceSummary()}
          </article>
        )}

        <article className="panel database-panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">{options.rowsEyebrow}</p>
              <h3>{options.rowsTitle}</h3>
            </div>
          </div>

          {options.hideControlsPanel && (
            <>
              {renderTableSummary()}
              {renderWorkspaceControls()}
              {renderWorkspaceSummary()}
            </>
          )}

          {!selectedTable ? (
            <p className="empty-state">The selected Supabase table could not be loaded.</p>
          ) : isDatabaseLoading ? (
            <p className="empty-state">Loading rows from Supabase...</p>
          ) : databaseRows.length === 0 ? (
            <p className="empty-state">This table is empty.</p>
          ) : filteredDatabaseRows.length === 0 ? (
            <p className="empty-state">No rows match the current search and column filters.</p>
          ) : (
            <div className="table-shell">
              <table className="database-table">
                <thead>
                  <tr>
                    {visibleDatabaseColumns.map((column) => (
                      <th key={column.name} className="database-header-cell">
                        <div className="database-header-top">
                          <div>{column.label}</div>
                          {renderDatabaseColumnFilterMenu(column)}
                        </div>
                        {!(activeView === "supplierData" || activeView === "database" || activeView === "projects") ? (
                          <span className="column-meta">
                            {column.type}
                            {column.editable ? " editable" : " read-only"}
                          </span>
                        ) : null}
                      </th>
                    ))}
                    {!useBulkSave ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredDatabaseRows.map((row) => {
                    const rowId = getRowId(row, selectedTable);
                    const rowDraft = databaseDrafts[rowId];
                    const hasDraft = Boolean(rowDraft && Object.keys(rowDraft).length > 0);

                    return (
                      <tr key={rowId}>
                        {visibleDatabaseColumns.map((column) => {
                          const value = getDatabaseValue(rowId, column.name, row[column.name]);
                          const isEditing = editingDatabaseCell === `${rowId}-${column.name}`;

                          return (
                            <td key={column.name}>
                              {column.editable ? (
                                isEditing || column.type === "boolean" ? (
                                  renderDatabaseEditor(column, rowId, value)
                                ) : (
                                  <div
                                    className={`cell-readonly ${activeView === "projects" ? "editable-affordance" : ""}`}
                                    onClick={() => setEditingDatabaseCell(`${rowId}-${column.name}`)}
                                    style={{
                                      cursor: "pointer",
                                      minHeight: "24px",
                                      borderBottom: hasDraft && column.name in rowDraft ? '1px dashed var(--primary-brand)' : '1px solid transparent'
                                    }}
                                    title="Click to edit"
                                  >
                                    {(() => {
                                      const actual = serializeCellValue(value);
                                      if (actual) return actual;
                                      const fallback = deriveDatabaseFallbackValue(column, row);
                                      return (
                                        <span className="cell-placeholder">
                                          {fallback}
                                          {activeView === "projects" ? (
                                            <span className="edit-indicator" aria-hidden>
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                                            </span>
                                          ) : null}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                )
                              ) : (
                                <div className="cell-readonly">
                                  {serializeCellValue(row[column.name]) || "null"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {!useBulkSave ? (
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={!hasDraft || savingDatabaseRowId === rowId}
                                onClick={() => void saveDatabaseRow(rowId)}
                              >
                                {savingDatabaseRowId === rowId ? "Saving..." : "Save row"}
                              </button>
                              <button
                                type="button"
                                className="button-secondary button-ghost"
                                disabled={!hasDraft || savingDatabaseRowId === rowId}
                                onClick={() => discardDatabaseDraft(rowId)}
                              >
                                Reset
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    );
  }

  const headerCopy =
    activeView === "imports"
      ? {
          tag: "Supplier Import Review",
          title:
            "Upload supplier CSV files, verify field mapping, then publish into the procurement catalog.",
        }
      : activeView === "projects"
        ? {
            tag: "Project Management",
            title:
              "Manage project records, delivery addresses, approval thresholds, and project-specific price lists.",
          }
      : activeView === "orders"
        ? {
            tag: "Order Control",
            title:
              "Route foreman orders through threshold-based approvals while keeping site teams moving.",
          }
      : activeView === "catalog"
        ? {
            tag: "Catalog Stewardship",
            title: "Clean product names, normalize categories, and keep the catalog consistent.",
          }
        : activeView === "supplierData"
          ? {
              tag: "Supplier Data",
              title: "Manage supplier master data, including discounts, without opening the raw database view.",
            }
        : {
            tag: "Supabase Data Manager",
            title:
              "Browse live Supabase tables and update supplier or product records directly.",
          };

  const viewNavigation = [
    {
      key: "imports" as const,
      label: "Import",
      description: "CSV uploads, field mapping, AI preview",
      count: imports.length,
    },
    {
      key: "projects" as const,
      label: "Projects",
      description: "Project setup and special price imports",
      count: projects.length,
    },
    {
      key: "orders" as const,
      label: "Orders",
      description: "Drafts, approvals, and delivery status",
      count: orders.length,
    },
    {
      key: "spendAnalytics" as const,
      label: "Spend Analytics",
      description: "Project budgets and C-material spend",
      count: projects.length,
    },
    {
      key: "catalog" as const,
      label: "Catalog",
      description: "Cleanup queue and bulk edits",
      count: catalogItems.length,
    },
  ];

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="sidebar-header">
          <div className="account-selector">
            <div className="account-avatar">1</div>
            <span>comstruct</span>
            <svg style={{marginLeft: "auto"}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace sections">
          {viewNavigation.map((item) => (
            <button
              key={item.key}
              className={`${activeView === item.key ? "nav-button active" : "nav-button"} ${
                item.key === "orders" && unreadOrderCount > 0 && activeView !== "orders"
                  ? "unread"
                  : ""
              }`}
              onClick={() => {
                setActiveView(item.key);
                if (item.key === "projects") {
                  void loadDatabaseRows("projects").catch((loadError) => {
                    setError(
                      loadError instanceof Error ? loadError.message : "Project data could not be loaded."
                    );
                  });
                }
              }}
              type="button"
            >
              <span className="nav-icon">
                <SidebarIcon view={item.key} />
              </span>
              <span className="nav-copy">
                {item.label}
              </span>
              <span className="nav-badge">{item.count}</span>
              {item.key === "orders" && unreadOrderCount > 0 && activeView !== "orders" ? (
                <span className="nav-new-label" aria-label={`${unreadOrderCount} unread orders`}>new</span>
              ) : null}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace-main">
        <header className="top-nav">
           <a className="top-nav-link">Feedback</a>
           <a className="top-nav-link">Help</a>
           <a className="top-nav-link">Docs</a>
        </header>

        <div className="content-container">
          {orderToastMessage ? (
            <div className="floating-toast" role="status" aria-live="polite">
              <span>{orderToastMessage}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={dismissOrderToast}
              >
                ×
              </button>
            </div>
          ) : null}

          <header className="page-header">
            <h1 className="page-title">{headerCopy.tag}</h1>
            <p className="page-description">{headerCopy.title}</p>
          </header>
          
          {activeView === "imports" ? (
            <div className="button-row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowImportHistory((s) => !s)}
                aria-expanded={showImportHistory}
              >
                {showImportHistory ? "Hide history" : `History (${imports.length})`}
              </button>
            </div>
          ) : null}

          {/* Import history dropdown (hidden by default) */}
          {activeView === "imports" ? (
            <div style={{ marginTop: 8 }}>
              {showImportHistory ? (
                <div className="import-history-dropdown panel" style={{ maxHeight: 320, overflow: 'auto' }}>
                  <div style={{ padding: 8, borderBottom: '1px solid var(--border-light)' }}>
                    <strong>Import history</strong>
                  </div>
                  <div style={{ display: 'grid', gap: 6, padding: 8 }}>
                    {imports.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)' }}>No recent imports</div>
                    ) : (
                      imports.map((imp) => (
                        <div key={imp.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <div style={{ flex: '1 1 220px' }}>
                            <div style={{ fontWeight: 600 }}>{imp.fileName}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{imp.supplierNames.join(', ')}</div>
                          </div>
                          <div style={{ width: 160, color: 'var(--text-secondary)' }}>{new Date(imp.createdAt).toLocaleString()}</div>
                          <div><span className={`status-pill ${imp.status}`}>{imp.status}</span></div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="data-container">
            {error ? <p className="banner error">{error}</p> : null}
            {success ? <p className="banner success">{success}</p> : null}

            {activeView === "imports" && imports.length === 0 && !selectedFile && !selectedPdfFile ? (
              <div className="empty-state-layout">
                <div className="empty-state-title">
                  {imports.length === 0 ? "No imports yet" : "No matching imports"}
                </div>
                <div className="empty-state-desc">
                  {imports.length === 0
                    ? "Start importing supplier data and CSV mapping to see them here."
                    : "Open the history to see existing imports."}
                </div>
                <button className="btn-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Go to docs
                </button>
              </div>
            ) : null}

            { /* moved import history to dropdown under toolbar */ }

            {activeView === "imports" ? (
              <>
              <section className="content-grid">
                <article className="panel upload-panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-eyebrow">Import flow</p>
                      <h3>Upload supplier catalog CSV / PDF</h3>
                    </div>
                  </div>

                  <form
                    className="upload-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void uploadCsv();
                    }}
                  >
                    <label className="field">
                      <span>CSV file</span>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                      />
                    </label>

                    <label className="field">
                      <span>PDF file</span>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={(event) => setSelectedPdfFile(event.target.files?.[0] ?? null)}
                      />
                    </label>

                    <div className="button-row">
                      <button type="submit" disabled={isUploading || !selectedFile} className="btn-primary">
                        {isUploading ? "Building preview..." : "Create preview"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={isUploading || !selectedPdfFile}
                    onClick={() => void uploadPdf()}
                  >
                    {isUploading ? "Building preview..." : "Create PDF preview"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={
                      isUploading ||
                      mappingDraft.length === 0 ||
                      (!selectedFile && !selectedPdfFile)
                    }
                    onClick={() => {
                      if (selectedPdfFile && !selectedFile) {
                        void uploadPdf(mappingDraft);
                        return;
                      }
                      void uploadCsv(mappingDraft);
                    }}
                  >
                    Refresh preview
                  </button>
                </div>
              </form>

            </article>

            <article className="panel preview-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Mapping review</p>
                  <h3>Preview and normalize before import</h3>
                </div>
                {preview ? (
                  <button
                    type="button"
                    onClick={() => void confirmCurrentImport()}
                    disabled={isConfirming}
                  >
                    {isConfirming ? "Importing..." : "Import into catalog"}
                  </button>
                ) : null}
              </div>

              {!preview ? (
                isUploading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div className="spinner" role="status" aria-label="Building preview"></div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Building preview&hellip;</div>
                  </div>
                ) : (
                  <p className="empty-state">
                    Upload a supplier CSV or PDF to inspect the field mapping and review all
                    normalized rows before committing them.
                  </p>
                )
              ) : (
                <>
                  {isUploading ? (
                    <div className="preview-overlay"><div className="spinner" aria-hidden /></div>
                  ) : null}
                  <div className="preview-stats">
                    <article>
                      <span>Rows</span>
                      <strong>{preview.importBatch.totalRows}</strong>
                    </article>
                    <article>
                      <span>Suppliers</span>
                      <strong>{preview.importBatch.supplierNames.length}</strong>
                    </article>
                    <article>
                      <span>Columns</span>
                      <strong>{preview.importBatch.detectedColumns.length}</strong>
                    </article>
                  </div>

                  <div className="table-shell" style={{ overflowX: "auto" }}>
                    <table style={{ whiteSpace: "nowrap", minWidth: "100%" }}>
                      <thead>
                        <tr>
                          <th style={{ minWidth: "180px", padding: "12px" }}>
                            <div className="mapping-header">Normalized family</div>
                            <select
                              value={
                                derivedMappingDraft.find((entry) => entry.field === "familyName")
                                  ?.target ?? "family_name"
                              }
                              style={{ width: "100%" }}
                              onChange={(event) =>
                                updateDerivedMapping(
                                  "familyName",
                                  event.target.value as DerivedFieldTarget
                                )
                              }
                            >
                              {DERIVED_FIELD_TARGETS.familyName.map((target) => (
                                <option key={target} value={target}>
                                  {DERIVED_TARGET_LABELS[target]}
                                </option>
                              ))}
                            </select>
                          </th>
                          <th style={{ minWidth: "180px", padding: "12px" }}>
                            <div className="mapping-header">Variant</div>
                            <select
                              value={
                                derivedMappingDraft.find((entry) => entry.field === "variantLabel")
                                  ?.target ?? "variant_label"
                              }
                              style={{ width: "100%" }}
                              onChange={(event) =>
                                updateDerivedMapping(
                                  "variantLabel",
                                  event.target.value as DerivedFieldTarget
                                )
                              }
                            >
                              {DERIVED_FIELD_TARGETS.variantLabel.map((target) => (
                                <option key={target} value={target}>
                                  {DERIVED_TARGET_LABELS[target]}
                                </option>
                              ))}
                            </select>
                          </th>
                          <th style={{ minWidth: "220px", padding: "12px" }}>
                            <div className="mapping-header">Variant attributes</div>
                            <select
                              value={
                                derivedMappingDraft.find(
                                  (entry) => entry.field === "variantAttributes"
                                )?.target ?? "variant_attributes"
                              }
                              style={{ width: "100%" }}
                              onChange={(event) =>
                                updateDerivedMapping(
                                  "variantAttributes",
                                  event.target.value as DerivedFieldTarget
                                )
                              }
                            >
                              {DERIVED_FIELD_TARGETS.variantAttributes.map((target) => (
                                <option key={target} value={target}>
                                  {DERIVED_TARGET_LABELS[target]}
                                </option>
                              ))}
                            </select>
                          </th>
                          <th style={{ minWidth: "160px", padding: "12px" }}>
                            <div className="mapping-header">Normalized category</div>
                            <select
                              value={
                                derivedMappingDraft.find(
                                  (entry) => entry.field === "normalizedCategory"
                                )?.target ?? "category"
                              }
                              style={{ width: "100%" }}
                              onChange={(event) =>
                                updateDerivedMapping(
                                  "normalizedCategory",
                                  event.target.value as DerivedFieldTarget
                                )
                              }
                            >
                              {DERIVED_FIELD_TARGETS.normalizedCategory.map((target) => (
                                <option key={target} value={target}>
                                  {DERIVED_TARGET_LABELS[target]}
                                </option>
                              ))}
                            </select>
                          </th>
                          {mappingDraft.map((entry) => (
                            <th key={entry.sourceColumn} style={{ minWidth: "180px", padding: "12px" }}>
                              <div className="mapping-header">{entry.sourceColumn}</div>
                              <select
                                value={entry.target}
                                style={{ width: "100%" }}
                                onChange={(event) =>
                                  setMappingDraft((current) =>
                                    current.map((mappingEntry) =>
                                      mappingEntry.sourceColumn === entry.sourceColumn
                                        ? {
                                            ...mappingEntry,
                                            target:
                                              event.target.value as
                                                | CsvImportFieldTarget
                                                | "ignore",
                                          }
                                        : mappingEntry
                                    )
                                  )
                                }
                              >
                                <option value="ignore">Ignore</option>
                                {CSV_IMPORT_TARGETS.map((target) => (
                                  <option key={target} value={target}>
                                    {TARGET_LABELS[target]}
                                  </option>
                                ))}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.map((row, index) => {
                          const previewRow = preview.previewRows[index];

                          return (
                          <tr key={index}>
                            <td>{previewRow?.familyName || <span style={{ color: "#d1d5db" }}>---</span>}</td>
                            <td>{previewRow?.variantLabel || "standard"}</td>
                            <td>
                              {previewRow && previewRow.variantAttributes.length > 0
                                ? previewRow.variantAttributes
                                    .map((attribute) => `${attribute.key}: ${attribute.value}`)
                                    .join(", ")
                                : "none"}
                            </td>
                            <td>{previewRow?.normalizedCategory || "---"}</td>
                            {mappingDraft.map((entry) => (
                              <td key={entry.sourceColumn}>
                                {row[entry.sourceColumn] || (
                                  <span style={{ color: "#d1d5db" }}>---</span>
                                )}
                              </td>
                            ))}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>
          </section>

          <section className="content-grid project-workspace-grid">
            <div className="panel-stack">
              <article className="panel upload-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-eyebrow">Project pricing</p>
                    <h3>Import special prices</h3>
                  </div>
                </div>

                <form
                  className="upload-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void previewProjectPrices();
                  }}
                >
                  <label className="field">
                    <span>Existing project</span>
                    <select
                      value={selectedProjectId}
                      onChange={(event) => setSelectedProjectId(event.target.value)}
                    >
                      <option value="">Select project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Special price CSV</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) =>
                        setSelectedProjectPriceFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <p className="field-help">
                      Expected columns: `supplier_name`, `supplier_sku`, and `project_price`.
                    </p>
                  </label>

                  <div className="button-row">
                    <button type="submit" disabled={isProjectPriceUploading}>
                      {isProjectPriceUploading ? "Matching prices..." : "Preview project prices"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        isProjectPriceUploading ||
                        !selectedProjectPriceFile ||
                        projectPriceMappingDraft.length === 0
                      }
                      onClick={() => void previewProjectPrices(projectPriceMappingDraft)}
                    >
                      Refresh preview
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={
                        isProjectPriceConfirming ||
                        !selectedProjectPriceFile ||
                        !selectedProjectId ||
                        !projectPricePreview
                      }
                      onClick={() => void confirmProjectPrices()}
                    >
                      {isProjectPriceConfirming ? "Importing..." : "Import project prices"}
                    </button>
                  </div>
                </form>
              </article>
            </div>

            <article className="panel preview-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Project price review</p>
                  <h3>Review matched rows before writing project-specific prices</h3>
                </div>
              </div>

              {!projectPricePreview ? (
                <p className="empty-state">
                  Select a project, upload a CSV with special prices, and preview the matched
                  supplier SKUs before import.
                </p>
              ) : (
                <>
                  <div className="preview-stats">
                    <article>
                      <span>Rows</span>
                      <strong>{projectPricePreview.totalRows}</strong>
                    </article>
                    <article>
                      <span>Matched</span>
                      <strong>{projectPricePreview.matchedRows}</strong>
                    </article>
                    <article>
                      <span>Unmatched</span>
                      <strong>{projectPricePreview.unmatchedRows}</strong>
                    </article>
                  </div>

                  <div className="project-chip-row">
                    <span className="database-chip">
                      Import target: {projectPricePreview.project.name}
                    </span>
                    {formatProjectLocation(projectPricePreview.project) && (
                      <span className="database-chip">
                        Location: {formatProjectLocation(projectPricePreview.project)}
                      </span>
                    )}
                  </div>

                  <div className="table-shell" style={{ overflowX: "auto" }}>
                    <table style={{ whiteSpace: "nowrap", minWidth: "100%" }}>
                      <thead>
                        <tr>
                          {projectPriceMappingDraft.map((entry) => (
                            <th key={entry.sourceColumn} style={{ minWidth: "180px", padding: "12px" }}>
                              <div className="mapping-header">{entry.sourceColumn}</div>
                              <select
                                value={entry.target}
                                style={{ width: "100%" }}
                                onChange={(event) =>
                                  setProjectPriceMappingDraft((current) =>
                                    current.map((mappingEntry) =>
                                      mappingEntry.sourceColumn === entry.sourceColumn
                                        ? {
                                            ...mappingEntry,
                                            target:
                                              event.target.value as
                                                | ProjectPriceImportFieldTarget
                                                | "ignore",
                                          }
                                        : mappingEntry
                                    )
                                  )
                                }
                              >
                                <option value="ignore">Ignore</option>
                                {PROJECT_PRICE_IMPORT_TARGETS.map((target) => (
                                  <option key={target} value={target}>
                                    {PROJECT_PRICE_TARGET_LABELS[target]}
                                  </option>
                                ))}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projectPricePreview.sampleRows.map((row, index) => (
                          <tr key={`sample-${index}`}>
                            {projectPriceMappingDraft.map((entry) => (
                              <td key={entry.sourceColumn}>
                                {row[entry.sourceColumn] || (
                                  <span style={{ color: "#d1d5db" }}>---</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="table-shell">
                    <table className="catalog-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Supplier</th>
                          <th>Supplier SKU</th>
                          <th>Product</th>
                          <th>Contract</th>
                          <th>Project Price</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projectPricePreview.rows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.supplierSku}-${row.supplierName}`}>
                            <td>{row.rowNumber}</td>
                            <td>{row.supplierName || "---"}</td>
                            <td>{row.supplierSku || "---"}</td>
                            <td>{row.productName || "---"}</td>
                            <td>{row.currentContractPrice != null ? EUR_FORMATTER.format(row.currentContractPrice) : "---"}</td>
                            <td>{row.projectPrice ?? "---"}</td>
                            <td>{row.status === "matched" ? "matched" : row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>
          </section>
          </>
        ) : activeView === "projects" ? (
          <>
            <section className="content-grid">
              <article className="panel database-panel full-width-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-eyebrow">Managed projects</p>
                    <h3>Projects in Supabase</h3>
                  </div>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void saveAllDatabaseDrafts()}
                    disabled={isSavingAll || databaseDraftCount === 0}
                  >
                    {isSavingAll
                      ? "Saving..."
                      : databaseDraftCount > 0
                        ? `Save ${databaseDraftCount} changes`
                        : "All changes saved"}
                  </button>
                </div>

                {!selectedTable ? (
                  <p className="empty-state">The selected Supabase table could not be loaded.</p>
                ) : isDatabaseLoading ? (
                  <p className="empty-state">Loading rows from Supabase...</p>
                ) : filteredProjectRows.length === 0 ? (
                  <p className="empty-state">
                    {databaseRows.length === 0
                      ? "No projects found yet."
                      : "No projects available for this view."}
                  </p>
                ) : (
                  <div className="table-shell">
                    <table className="database-table">
                      <thead>
                        <tr>
                          {visibleDatabaseColumns.map((column) => (
                            <th key={column.name} className="database-header-cell">
                              <div>{column.label}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProjectRows.map((row) => {
                          const rowId = getRowId(row, selectedTable);
                          const rowDraft = databaseDrafts[rowId] ?? {};

                          return (
                            <tr key={rowId}>
                              {visibleDatabaseColumns.map((column) => {
                                const value = getDatabaseValue(rowId, column.name, row[column.name]);
                                const isEditing = editingDatabaseCell === `${rowId}-${column.name}`;
                                const isDirty = column.name in rowDraft;

                                return (
                                  <td key={column.name}>
                                    {column.editable ? (
                                      isEditing || column.type === "boolean" ? (
                                        renderDatabaseEditor(column, rowId, value)
                                      ) : (
                                        <div
                                          className={`cell-readonly ${activeView === "projects" ? "editable-affordance" : ""}`}
                                          onClick={() =>
                                            setEditingDatabaseCell(`${rowId}-${column.name}`)
                                          }
                                          style={{
                                            cursor: "pointer",
                                            minHeight: "24px",
                                            borderBottom: isDirty
                                              ? "1px dashed var(--primary-brand)"
                                              : "1px solid transparent",
                                          }}
                                          title="Click to edit"
                                        >
                                          {(() => {
                                            const actual = serializeCellValue(value);
                                            if (actual) return actual;
                                            const fallback = deriveDatabaseFallbackValue(column, row);
                                            return (
                                              <span className="cell-placeholder">
                                                {fallback}
                                                <span className="edit-indicator" aria-hidden>
                                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                                                </span>
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      )
                                    ) : (
                                      <div className="cell-readonly">
                                        {serializeCellValue(row[column.name]) || "null"}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </section>

            <section className="content-grid project-workspace-grid">
              <div className="panel-stack">
                <article className="panel upload-panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-eyebrow">New project</p>
                      <h3>Create a project</h3>
                    </div>
                  </div>

                  <form
                    className="upload-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveProject();
                    }}
                  >
                    <label className="field">
                      <span>Project name</span>
                      <input
                        value={newProjectName}
                        onChange={(event) => setNewProjectName(event.target.value)}
                        placeholder="Project name"
                      />
                    </label>

                    <label className="field">
                      <span>Address</span>
                      <input
                        value={newProjectAddress}
                        onChange={(event) => setNewProjectAddress(event.target.value)}
                        placeholder="Street and number"
                      />
                    </label>

                    <div className="project-form-split">
                      <label className="field">
                        <span>City</span>
                        <input
                          value={newProjectCity}
                          onChange={(event) => setNewProjectCity(event.target.value)}
                          placeholder="City"
                        />
                      </label>

                      <label className="field">
                        <span>ZIP code</span>
                        <input
                          value={newProjectZipCode}
                          onChange={(event) => setNewProjectZipCode(event.target.value)}
                          placeholder="ZIP code"
                        />
                      </label>
                    </div>

                    <div className="button-row">
                      <button type="submit" disabled={isProjectSaving}>
                        {isProjectSaving ? "Creating..." : "Create project"}
                      </button>
                    </div>
                  </form>
                </article>

              </div>
            </section>
          </>
        ) : activeView === "orders" ? (
          <section className="orders-layout">
            <div className="header-stats">
              <button
                type="button"
                className={`stat-card attention ${
                  orderStatusFilter === "pending_approval" ? "active" : ""
                }`}
                onClick={() =>
                  setOrderStatusFilter((current) =>
                    current === "pending_approval" ? "all" : "pending_approval"
                  )
                }
              >
                <span className="stat-label">Pending</span>
                <strong>{orderStatusCounts.pending_approval}</strong>
              </button>
              <button
                type="button"
                className={`stat-card ${orderStatusFilter === "ordered" ? "active" : ""}`}
                onClick={() =>
                  setOrderStatusFilter((current) => (current === "ordered" ? "all" : "ordered"))
                }
              >
                <span className="stat-label">Ordered</span>
                <strong>{orderStatusCounts.ordered}</strong>
              </button>
              <button
                type="button"
                className={`stat-card ${orderStatusFilter === "delivered" ? "active" : ""}`}
                onClick={() =>
                  setOrderStatusFilter((current) =>
                    current === "delivered" ? "all" : "delivered"
                  )
                }
              >
                <span className="stat-label">Delivered</span>
                <strong>{orderStatusCounts.delivered}</strong>
              </button>
              <button
                type="button"
                className={`stat-card ${orderStatusFilter === "rejected" ? "active" : ""}`}
                onClick={() =>
                  setOrderStatusFilter((current) => (current === "rejected" ? "all" : "rejected"))
                }
              >
                <span className="stat-label">Declined</span>
                <strong>{orderStatusCounts.rejected}</strong>
              </button>
            </div>

            <article className="panel catalog-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Orders</p>
                  <h3>Review, approve, and decline site requests</h3>
                </div>
                <label className="field compact order-filter-field">
                  <span>Project</span>
                  <select
                    value={orderProjectFilter}
                    onChange={(event) => setOrderProjectFilter(event.target.value)}
                  >
                    <option value="all">All projects</option>
                    {orderProjectOptions.map((project) => (
                      <option key={project.value} value={project.value}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="order-filters-summary">
                <span className="database-chip">
                  Project:{" "}
                  {orderProjectFilter === "all"
                    ? "All projects"
                    : orderProjectOptions.find((project) => project.value === orderProjectFilter)?.label ??
                      "Selected project"}
                </span>
                {orderStatusFilter !== "all" || orderProjectFilter !== "all" ? (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setOrderStatusFilter("all");
                      setOrderProjectFilter("all");
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>

              {isOrderLoading ? (
                <p className="empty-state">Loading orders...</p>
              ) : filteredOrders.length === 0 ? (
                <p className="empty-state">
                  {orders.length === 0
                    ? "No orders yet."
                    : orderStatusFilter === "pending_approval" && orderProjectFilter === "all"
                      ? "No orders currently need approval."
                      : "No orders match the current filters."}
                </p>
              ) : (
                <div className="order-list">
                  {(
                    // Extra safety: ensure rendered orders exactly match the active status filter
                    filteredOrders.filter((o) =>
                      orderStatusFilter === "all" ? true : o.status === orderStatusFilter
                    )
                  ).map((order) => (
                    <article
                      className={`order-card ${
                        order.status === "pending_approval" ? "approval-needed" : ""
                      }`}
                      key={order.id}
                    >
                      {(() => {
                        const dateLabel =
                          order.status === "pending_approval" || order.status === "rejected"
                            ? "Requested"
                            : order.status === "ordered" || order.status === "delivered"
                              ? "Ordered"
                              : "Created";
                        const dateValue =
                          order.status === "pending_approval" || order.status === "rejected"
                            ? order.submittedAt ?? order.createdAt
                            : order.status === "ordered" || order.status === "delivered"
                              ? order.orderedAt ?? order.createdAt
                              : order.createdAt;

                        return (
                          <>
                      <div className="order-card-header">
                        <div>
                          <strong>{order.projectName}</strong>
                          <p>{order.foremanName}</p>
                        </div>
                        <div className="order-card-statuses">
                          <span className={`status-pill ${order.status.replace("_", "-")}`}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>
                        </div>
                      </div>

                      <div className="order-card-meta">
                        <span className="order-meta-highlight">
                          Order sum: {EUR_FORMATTER.format(order.totalAmount ?? 0)}
                        </span>
                        <span className="order-meta-highlight">
                          {dateLabel}:{" "}
                          {new Date(dateValue).toLocaleString("de-DE", {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>Route: {APPROVAL_ROUTE_LABELS[order.approvalRoute]}</span>
                        <span>{order.items.length} items</span>
                      </div>

                      <p className="order-reason">{order.approvalReason}</p>

                      <details className="order-items-dropdown">
                        <summary>
                          <span>Items in this order</span>
                          <span>{order.items.length}</span>
                        </summary>
                        {order.items.length === 0 ? (
                          <p className="order-item-empty">No line items recorded for this order.</p>
                        ) : (
                          <div className="order-item-list">
                            {order.items.map((item) => (
                              <div className="order-item-row" key={item.id}>
                                <span>{item.displayName}</span>
                                <span>
                                  {item.quantity} x {EUR_FORMATTER.format(item.unitPrice ?? 0)} = {EUR_FORMATTER.format(item.lineTotal ?? 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </details>

                      <div className="button-row">
                        {order.status === "pending_approval" ? (
                          <>
                            <button
                              type="button"
                              className="button-success"
                              disabled={savingOrderId === order.id}
                              onClick={() => void updateOrderStatus(order.id, "approve")}
                            >
                              {savingOrderId === order.id ? "Approving..." : "Approve"}
                            </button>
                            <button
                              type="button"
                              className="button-danger"
                              disabled={savingOrderId === order.id}
                              onClick={() => startRejectingOrder(order.id)}
                            >
                              {rejectingOrderId === order.id ? "Close rejection" : "Reject"}
                            </button>
                          </>
                        ) : null}
                        {order.status === "ordered" ? (
                          <button
                            type="button"
                            disabled={savingOrderId === order.id}
                            onClick={() => void updateOrderStatus(order.id, "mark_delivered")}
                          >
                            {savingOrderId === order.id ? "Updating..." : "Mark delivered"}
                          </button>
                        ) : null}
                      </div>

                      {order.status === "pending_approval" && rejectingOrderId === order.id ? (
                        <div className="order-rejection-panel">
                          <label className="field">
                            <span>Reason for rejection</span>
                            <textarea
                              className="field-textarea"
                              value={rejectionReasonDraft}
                              onChange={(event) => setRejectionReasonDraft(event.target.value)}
                              placeholder="Explain why this order should be rejected."
                            />
                          </label>
                          <div className="button-row">
                            <button
                              type="button"
                              className="button-danger"
                              disabled={savingOrderId === order.id}
                              onClick={() => void submitOrderRejection(order.id)}
                            >
                              {savingOrderId === order.id ? "Rejecting..." : "Confirm rejection"}
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={savingOrderId === order.id}
                              onClick={() => {
                                setRejectingOrderId(null);
                                setRejectionReasonDraft("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                          </>
                        );
                      })()}
                    </article>
                  ))}
                </div>
              )}
            </article>
          </section>
        ) : activeView === "spendAnalytics" ? (
          <section className="content-grid">
            <article className="panel database-panel full-width-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Spend Analytics</p>
                  <h3>Project C-material spend vs. budget</h3>
                  <p className="subline">
                    Budget basis uses project daily budget multiplied by project runtime days.
                  </p>
                </div>
                <div style={{ marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setSelectedAnalyticsProjectIds(analyticsData.map((p) => p.projectId));
                    }}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setSelectedAnalyticsProjectIds([])}
                    style={{ marginLeft: 8 }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div style={{ padding: 12 }}>
                <div className="analytics-controls">
                  {projects.map((proj) => (
                    <label key={proj.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={selectedAnalyticsProjectIds.includes(proj.id)}
                        onChange={(e) => {
                          setSelectedAnalyticsProjectIds((current) => {
                            if (e.target.checked) return Array.from(new Set([...current, proj.id]));
                            return current.filter((id) => id !== proj.id);
                          });
                        }}
                      />
                      <span>{proj.name}</span>
                    </label>
                  ))}
                  <div style={{ marginLeft: "auto", color: "var(--text-secondary)" }}>
                    {isAnalyticsLoading ? "Loading analytics..." : `${analyticsData.length} projects`}
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  {selectedAnalyticsProjectIds.length === 0 ? (
                    <p className="empty-state">No projects selected. Choose projects to display analytics.</p>
                  ) : (
                    <div>
                      <div>
                        {portfolioSortedProjects.map((p) => {
                            const budgetBase = p.budgetTotal > 0 ? p.budgetTotal : 1;
                            const usedPercent = Math.max(0, (p.actualSpend / budgetBase) * 100);
                            const isExceeded = usedPercent > 100;
                            const BAR_SCALE_MAX_PERCENT = 150;
                            const displayPercent = Math.min(
                              100,
                              (Math.min(BAR_SCALE_MAX_PERCENT, usedPercent) / BAR_SCALE_MAX_PERCENT) * 100
                            );
                            const variance = p.actualSpend - p.budgetTotal;

                            return (
                              <div key={p.projectId} className="analytics-row">
                                <div className="analytics-row-label">{p.projectName}</div>
                                <div className={`analytics-bars ${isExceeded ? "exceeded" : ""}`} aria-hidden>
                                  <div className="analytics-bar-budget" style={{ width: "100%" }} />
                                  <div
                                    className={`analytics-bar-actual ${isExceeded ? "over" : "ok"}`}
                                    style={{ width: `${displayPercent}%` }}
                                  />
                                  {isExceeded ? <div className="analytics-budget-marker" /> : null}
                                </div>
                                <div className="analytics-values">
                                  <div className="analytics-value-line">
                                    <span>Budget: {EUR_FORMATTER.format(p.budgetTotal)}</span>
                                  </div>
                                  <div className="analytics-value-line">
                                    <span>
                                      Spend: {EUR_FORMATTER.format(p.actualSpend)} ({Math.round(usedPercent)}%)
                                    </span>
                                    <span
                                      className={`status-pill analytics-inline-status ${
                                        isExceeded ? "rejected" : "ordered"
                                      }`}
                                    >
                                      {isExceeded ? "Exceeded" : "On Track"}
                                    </span>
                                  </div>
                                  <div className="analytics-value-line">
                                    <span>
                                      Variance: {variance >= 0 ? "+" : ""}
                                      {EUR_FORMATTER.format(variance)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>

            <article className="panel database-panel full-width-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Spend Drilldown</p>
                  <h3>Project-first drilldown for spend explanation</h3>
                </div>
              </div>

              <div className="analytics-detail-controls" style={{ padding: 12 }}>
                <label className="field compact">
                  <span>Scope</span>
                  <label className="checkbox" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={analyticsSplitByProject}
                      onChange={(event) => setAnalyticsSplitByProject(event.target.checked)}
                    />
                    <span>
                      {analyticsSplitByProject
                        ? "Split by project"
                        : "All selected projects combined"}
                    </span>
                  </label>
                </label>

                <label className="field compact">
                  <span>Sort by</span>
                  <select
                    value={analyticsSortBy}
                    onChange={(event) =>
                      setAnalyticsSortBy(
                        event.target.value as
                          | "attention"
                          | "spend_desc"
                          | "spend_asc"
                          | "newest"
                          | "oldest"
                      )
                    }
                  >
                    <option value="attention">Attention first</option>
                    <option value="spend_desc">Highest spend first</option>
                    <option value="spend_asc">Lowest spend first</option>
                    <option value="newest">Newest orders first</option>
                    <option value="oldest">Oldest orders first</option>
                  </select>
                </label>

                <label className="field compact">
                  <span>Category</span>
                  <select
                    value={analyticsCategoryFilter}
                    onChange={(event) => setAnalyticsCategoryFilter(event.target.value)}
                  >
                    <option value="all">All categories</option>
                    {analyticsCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field compact">
                  <span>Supplier</span>
                  <select
                    value={analyticsSupplierFilter}
                    onChange={(event) => setAnalyticsSupplierFilter(event.target.value)}
                  >
                    <option value="all">All suppliers</option>
                    {analyticsSupplierOptions.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field compact">
                  <span>Time period</span>
                  <select
                    value={analyticsTimeFilter}
                    onChange={(event) =>
                      setAnalyticsTimeFilter(event.target.value as "all" | "30d" | "90d")
                    }
                  >
                    <option value="all">All time</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                  </select>
                </label>

                <label className="field compact analytics-search-field">
                  <span>Search details</span>
                  <input
                    type="text"
                    value={analyticsSearchQuery}
                    onChange={(event) => setAnalyticsSearchQuery(event.target.value)}
                    placeholder="Search order ID, item, category, project..."
                  />
                </label>
              </div>

              <div style={{ padding: "0 12px 12px" }}>
                {selectedAnalyticsProjectIds.length === 0 ? (
                  <p className="empty-state">Select at least one project to explore spend details.</p>
                ) : analyticsSplitByProject ? (
                  analyticsProjectOrderGroups.every((group) => group.orders.length === 0) ? (
                    <p className="empty-state">No spend details match the current filters.</p>
                  ) : (
                    <div className="analytics-group-list">
                      {analyticsProjectOrderGroups
                        .map((projectGroup) => {
                          if (projectGroup.orders.length > 0) return projectGroup;
                          const rebuilt = buildAnalyticsRows(
                            filteredAnalyticsDetails.filter((e) => e.projectId === projectGroup.project.projectId),
                            "order"
                          ).map((row) => ({ ...row, status: row.entries[0]?.orderStatus ?? "draft" }));

                          return { ...projectGroup, orders: rebuilt };
                        })
                        .filter((group) => group.orders.length > 0)
                        .map((projectGroup) => (
                          <details key={projectGroup.project.projectId} className="analytics-project-group">
                            <summary className="analytics-project-heading">
                              <strong>{projectGroup.project.projectName}</strong>
                              <span>
                                Budget {EUR_FORMATTER.format(projectGroup.project.budgetTotal)} / Spend {" "}
                                {EUR_FORMATTER.format(projectGroup.project.actualSpend)}
                              </span>
                            </summary>

                            <div>
                              {projectGroup.orders.map((group) => (
                                <details
                                  key={`${projectGroup.project.projectId}-${group.key}`}
                                  className={`analytics-group-card ${
                                    group.total >= projectGroup.project.actualSpend * 0.35 ? "urgent" : ""
                                  }`}
                                >
                                  <summary>
                                    <span className="analytics-group-title">
                                      Order {group.key.slice(0, 8)}
                                      <span className="subline">{ORDER_STATUS_LABELS[group.status]}</span>
                                    </span>
                                    <span className="analytics-group-meta">
                                      <strong>{EUR_FORMATTER.format(group.total)}</strong>
                                      <span>{group.entries.length} items</span>
                                    </span>
                                  </summary>

                                  <div className="table-shell">
                                    <table className="catalog-table analytics-detail-table">
                                      <thead>
                                        <tr>
                                          <th>When</th>
                                          <th>Order</th>
                                          <th>Supplier</th>
                                          <th>Category</th>
                                          <th>Item</th>
                                          <th>Qty</th>
                                          <th>Unit Price</th>
                                          <th>Line Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {group.entries
                                          .slice()
                                          .sort((a, b) => b.lineTotal - a.lineTotal)
                                          .map((entry) => (
                                            <tr key={entry.itemId}>
                                              <td>{new Date(entry.orderedAt).toLocaleDateString("de-DE")}</td>
                                              <td>
                                                {entry.orderId.slice(0, 8)}
                                                <span className="subline">{ORDER_STATUS_LABELS[entry.orderStatus]}</span>
                                              </td>
                                              <td>{entry.supplierName}</td>
                                              <td>
                                                {entry.category}
                                                <span className="subline">{entry.subcategory || "n/a"}</span>
                                              </td>
                                              <td>{entry.itemName}</td>
                                              <td>{entry.quantity}</td>
                                              <td>{EUR_FORMATTER.format(entry.unitPrice)}</td>
                                              <td>{EUR_FORMATTER.format(entry.lineTotal)}</td>
                                            </tr>
                                          ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </details>
                              ))}
                            </div>
                          </details>
                        ))}
                    </div>
                  )
                ) : analyticsPortfolioRows.length === 0 ? (
                  <p className="empty-state">No spend details match the current filters.</p>
                ) : (
                  <div className="analytics-group-list">
                    {analyticsPortfolioRows.map((group) => {
                      const portfolioTotal = Math.max(
                        1,
                        filteredAnalyticsDetails.reduce((sum, entry) => sum + entry.lineTotal, 0)
                      );
                      return (
                        <details
                          key={group.key}
                          className={`analytics-group-card ${
                            group.total >= portfolioTotal * 0.35 ? "urgent" : ""
                          }`}
                        >
                          <summary>
                            <span className="analytics-group-title">{group.label}</span>
                            <span className="analytics-group-meta">
                              <strong>{EUR_FORMATTER.format(group.total)}</strong>
                              <span>{group.entries.length} items</span>
                            </span>
                          </summary>

                          <div className="table-shell">
                            <table className="catalog-table analytics-detail-table">
                              <thead>
                                <tr>
                                  <th>Project</th>
                                  <th>When</th>
                                  <th>Order</th>
                                  <th>Supplier</th>
                                  <th>Category</th>
                                  <th>Item</th>
                                  <th>Qty</th>
                                  <th>Unit Price</th>
                                  <th>Line Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.entries
                                  .slice()
                                  .sort((a, b) => b.lineTotal - a.lineTotal)
                                  .map((entry) => (
                                    <tr key={entry.itemId}>
                                      <td>{entry.projectName}</td>
                                      <td>{new Date(entry.orderedAt).toLocaleDateString("de-DE")}</td>
                                      <td>
                                        {entry.orderId.slice(0, 8)}
                                        <span className="subline">{ORDER_STATUS_LABELS[entry.orderStatus]}</span>
                                      </td>
                                      <td>{entry.supplierName}</td>
                                      <td>
                                        {entry.category}
                                        <span className="subline">{entry.subcategory || "n/a"}</span>
                                      </td>
                                      <td>{entry.itemName}</td>
                                      <td>{entry.quantity}</td>
                                      <td>{EUR_FORMATTER.format(entry.unitPrice)}</td>
                                      <td>{EUR_FORMATTER.format(entry.lineTotal)}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </div>
            </article>
          </section>
        ) : activeView === "catalog" ? (
          <section className="catalog-layout">
            <article className="panel filter-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Catalog filters</p>
                  <h3>Focus the cleanup queue</h3>
                </div>
              </div>

              <div className="filters catalog-filters">
                <label className="field compact catalog-search-field">
                  <span>Search catalog</span>
                  <input
                    type="text"
                    value={catalogSearchQuery}
                    onChange={(event) => setCatalogSearchQuery(event.target.value)}
                    placeholder="Type words like supplier, SKU, family, category..."
                  />
                </label>

                <label className="field compact">
                  <span>Supplier</span>
                  <select
                    value={filters.supplier}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, supplier: event.target.value }))
                    }
                  >
                    <option value="all">All suppliers</option>
                    {supplierOptions.map((supplier) => (
                      <option key={supplier} value={supplier}>
                        {supplier}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field compact">
                  <span>Category</span>
                  <select
                    value={filters.normalizedCategory}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        normalizedCategory: event.target.value as NormalizedCategory | "all",
                      }))
                    }
                  >
                    <option value="all">All categories</option>
                    {NORMALIZED_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field compact">
                  <span>Subcategory</span>
                  <select
                    value={filters.subcategory}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        subcategory: event.target.value,
                      }))
                    }
                  >
                    <option value="all">All subcategories</option>
                    {subcategoryOptions.map((subcategory) => (
                      <option key={subcategory} value={subcategory}>
                        {subcategory}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>

            <article className="panel catalog-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Cleanup queue</p>
                  <h3>Review imported products</h3>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={isCatalogSavingAll || pendingCatalogSaves.length === 0}
                  onClick={() => void saveCatalogTable()}
                >
                  {isCatalogSavingAll
                    ? "Saving..."
                    : pendingCatalogSaves.length > 0
                      ? `Save ${pendingCatalogSaves.length} changes`
                      : "All changes saved"}
                </button>
              </div>

              {catalogItems.length === 0 ? (
                <p className="empty-state">
                  The catalog is empty. Confirm an import from the Imports tab first.
                </p>
              ) : filteredCatalogItems.length === 0 ? (
                <p className="empty-state">
                  No catalog rows match the current search and selected filters.
                </p>
              ) : (
                <div className="table-shell">
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Supplier / SKU</th>
                        <th>Display name</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>C-material</th>
                        <th>Meta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCatalogItems.map((item) => {
                        const row = drafts[item.id] ?? item;

                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>{renderHighlightedText(item.supplierName, catalogSearchTerms)}</strong>
                              <span className="subline">
                                {renderHighlightedText(item.supplierSku, catalogSearchTerms)}
                              </span>
                            </td>
                            <td>
                              <input
                                value={row.displayName}
                                onChange={(event) =>
                                  updateDraftValue(item.id, "displayName", event.target.value)
                                }
                              />
                              {catalogSearchTerms.length > 0 ? (
                                <span className="subline">
                                  {renderHighlightedText(row.displayName, catalogSearchTerms)}
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <select
                                value={row.normalizedCategory}
                                onChange={(event) =>
                                  updateDraftValue(
                                    item.id,
                                    "normalizedCategory",
                                    event.target.value as NormalizedCategory
                                  )
                                }
                              >
                                {NORMALIZED_CATEGORIES.map((category) => (
                                  <option key={category} value={category}>
                                    {category}
                                  </option>
                                ))}
                              </select>
                              <span className="subline">
                                Subcategory: {renderHighlightedText(item.subcategory || "n/a", catalogSearchTerms)}
                              </span>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.unitPrice}
                                onChange={(event) =>
                                  updateDraftValue(
                                    item.id,
                                    "unitPrice",
                                    Number(event.target.value)
                                  )
                                }
                              />
                              <span className="subline">
                                {renderHighlightedText(item.unit, catalogSearchTerms)}
                              </span>
                            </td>
                            <td>
                              <div className="subline">C-material: {row.isCMaterial ? "Yes" : "No"}</div>
                            </td>
                            <td>
                              <span className="subline">
                                Use: {renderHighlightedText(item.consumptionType || "n/a", catalogSearchTerms)}
                              </span>
                              <span className="subline">
                                Site: {renderHighlightedText(item.typicalSite || "n/a", catalogSearchTerms)}
                              </span>
                              <span className="subline">
                                Family: {renderHighlightedText(item.familyName || "n/a", catalogSearchTerms)}
                              </span>
                              <span className="subline">
                                Variant: {renderHighlightedText(item.variantLabel || "standard", catalogSearchTerms)}
                              </span>
                              <span className="subline">
                                Hazardous: {item.hazardous ? "Yes" : "No"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
        ) : activeView === "supplierData" ? (
          renderDataWorkspace({
            controlsEyebrow: "Supplier controls",
            controlsTitle: "Review supplier master data",
            rowsEyebrow: "Supplier records",
            rowsTitle: selectedTable?.label ?? "Suppliers",
            summaryDescription:
              "Manage supplier records in one place and adjust the supplier-wide discount directly here.",
            summaryTags: ["Supplier discount", "Inline row editing", "Manual save per row"],
            searchPlaceholder: "Search supplier names, discount, contract status...",
            showTableSelector: false,
            hideControlsPanel: true,
            showWorkspaceHeader: false,
            showTableSummary: false,
            showWorkspaceSummary: false,
            useBulkSave: true,
          })
        ) : (
          renderDataWorkspace({
            controlsEyebrow: "Database controls",
            controlsTitle: "Filter and inspect rows",
            rowsEyebrow: "Live rows",
            rowsTitle: selectedTable?.label ?? "Normalized Products",
            summaryDescription:
              "Use the search and per-column filters to narrow the active Supabase table, then edit supplier or product values directly in the table on the right.",
            summaryTags: ["Search + column filters", "Inline row editing", "Manual save per row"],
            searchPlaceholder: "Search IDs, categories, product names, packaging, storage...",
            showTableSelector: true,
            useBulkSave: false,
          })
        )}
          </div>
        </div>
      </section>
    </main>
  );
}
