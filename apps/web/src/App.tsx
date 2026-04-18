import { useEffect, useMemo, useState } from "react";
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
  type UpdateCatalogItemInput,
} from "@comstruct/shared";
import { createProject, listProjects } from "./lib/projects";

const API_BASE = "http://localhost:4000/api";

type ViewKey = "imports" | "projects" | "orders" | "catalog" | "supplierData" | "database";

type CatalogFilterState = {
  supplier: string;
  normalizedCategory: NormalizedCategory | "all";
  subcategory: string;
};

type OrderStatusFilter = OrderStatus | "all";
type OrderProjectFilter = "all" | string;

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
  approved: "Approved",
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
  const payload = (await response.json()) as T | ErrorResponse;

  if (!response.ok) {
    const error = payload as ErrorResponse;
    throw new Error(
      error.details && error.details.length > 0
        ? `${error.error} ${error.details.join(", ")}`
        : error.error
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

  async function loadImports() {
    const response = await fetch(`${API_BASE}/imports`);
    const payload = await readJson<ImportBatchListResponse>(response);
    setImports(payload.imports);
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
      const [ordersResponse, catalogResponse] = await Promise.all([
        fetch(`${API_BASE}/procurement-orders`),
        fetch(`${API_BASE}/catalog-items?catalogStatus=published`),
      ]);

      const ordersPayload = await readJson<ProcurementOrdersResponse>(ordersResponse);
      const catalogPayload = await readJson<CatalogListResponse>(catalogResponse);

      setOrders(ordersPayload.orders);
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

  useEffect(() => {
    void (async () => {
      try {
        setError(null);
        await Promise.all([loadImports(), loadCatalog(), loadProjects()]);
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

  const supplierOptions = useMemo(
    () => Array.from(new Set(catalogItems.map((item) => item.supplierName))).sort(),
    [catalogItems]
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

        return true;
      }),
    [catalogItems, drafts, filters]
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

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const selectedProjectLocation = useMemo(
    () => (selectedProject ? formatProjectLocation(selectedProject) : null),
    [selectedProject]
  );

  const selectedOrderProject = useMemo(
    () => projects.find((project) => project.id === orderProjectId) ?? null,
    [orderProjectId, projects]
  );

  useEffect(() => {
    setProjectPricePreview(null);
    setProjectPriceMappingDraft([]);
  }, [selectedFile, selectedProjectId]);

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
          approved: 0,
          ordered: 0,
          delivered: 0,
          rejected: 0,
        }
      ),
    [projectFilteredOrders]
  );

  const filteredOrders = useMemo(
    () =>
      orderStatusFilter === "all"
        ? projectFilteredOrders
        : projectFilteredOrders.filter((order) => order.status === orderStatusFilter),
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
      setPreview(payload);
      setMappingDraft(payload.mapping);
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
    if (!selectedFile) {
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
    formData.append("file", selectedFile);
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
    if (!selectedFile || !selectedProjectId || !projectPricePreview) {
      return;
    }

    setIsProjectPriceConfirming(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
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
      setSelectedFile(null);
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
          ? "Order approved and sent to ordering."
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
          <div className="database-summary-meta">
            <span>Supabase table: {selectedDatabaseTable}</span>
            <span>Primary key: {selectedTable.primaryKey}</span>
            <span>
              Editable columns: {visibleDatabaseColumns.filter((column) => column.editable).length}
            </span>
          </div>
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
                        <span className="column-meta">
                          {column.type}
                          {column.editable ? " editable" : " read-only"}
                        </span>
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
                                    className="cell-readonly" 
                                    onClick={() => setEditingDatabaseCell(`${rowId}-${column.name}`)}
                                    style={{
                                      cursor: "pointer", 
                                      minHeight: "24px",
                                      borderBottom: hasDraft && column.name in rowDraft ? '1px dashed var(--primary-brand)' : '1px solid transparent'
                                    }}
                                    title="Click to edit"
                                  >
                                    {serializeCellValue(value) || <span style={{color: "var(--text-tertiary)"}}>Empty</span>}
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
      key: "catalog" as const,
      label: "Catalog",
      description: "Cleanup queue and bulk edits",
      count: catalogItems.length,
    },
    {
      key: "supplierData" as const,
      label: "Supplier Data",
      description: "Supplier master data and discount control",
      count: selectedDatabaseTable === "suppliers" ? databaseRowCount : 0,
    },
    {
      key: "database" as const,
      label: "Database",
      description: "Direct row editing in suppliers and products",
      count: DATABASE_TABLES.length,
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
              className={activeView === item.key ? "nav-button active" : "nav-button"}
              onClick={() => {
                setActiveView(item.key);
                if (item.key === "projects") {
                  void loadDatabaseRows("projects").catch((loadError) => {
                    setError(
                      loadError instanceof Error ? loadError.message : "Project data could not be loaded."
                    );
                  });
                } else if (item.key === "supplierData") {
                  void loadDatabaseRows("suppliers").catch((loadError) => {
                    setError(
                      loadError instanceof Error ? loadError.message : "Supplier data could not be loaded."
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
          <header className="page-header">
            <h1 className="page-title">{headerCopy.tag}</h1>
            <p className="page-description">{headerCopy.title}</p>
          </header>
          
          <div className="utility-toolbar">
            <div className="search-input-wrapper">
              <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" className="search-input" placeholder="Search..." />
            </div>
            <select className="filter-dropdown">
              <option>Last 15 days</option>
            </select>
            <select className="filter-dropdown">
              <option>All Statuses</option>
            </select>
            <button className="icon-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>

          <div className="data-container">
            {error ? <p className="banner error">{error}</p> : null}
            {success ? <p className="banner success">{success}</p> : null}

            {imports.length === 0 && activeView === "imports" && !selectedFile ? (
              <div className="empty-state-layout">
                <div className="empty-state-title">No imports yet</div>
                <div className="empty-state-desc">Start importing supplier data and CSV mapping to see them here.</div>
                <button className="btn-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  Go to docs
                </button>
              </div>
            ) : null}

            {activeView === "imports" ? (
              <section className="content-grid">
                <article className="panel upload-panel">
                  <div className="panel-header">
                    <div>
                      <p className="panel-eyebrow">Import flow</p>
                      <h3>Upload supplier catalog CSV</h3>
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

                    <div className="button-row">
                      <button type="submit" disabled={isUploading} className="btn-primary">
                        {isUploading ? "Building preview..." : "Create preview"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={isUploading || !selectedFile || mappingDraft.length === 0}
                    onClick={() => void uploadCsv(mappingDraft)}
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
                <p className="empty-state">
                  Upload a supplier CSV to inspect the field mapping and review all
                  normalized rows before committing them.
                </p>
              ) : (
                <>
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
        ) : activeView === "projects" ? (
          <>
            <section className="content-grid">
              <article className="panel database-panel">
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
                ) : databaseRows.length === 0 ? (
                  <p className="empty-state">No projects found yet.</p>
                ) : (
                  <div className="table-shell">
                    <table className="database-table">
                      <thead>
                        <tr>
                          {visibleDatabaseColumns.map((column) => (
                            <th key={column.name} className="database-header-cell">
                              <div>{column.label}</div>
                              <span className="column-meta">
                                {column.type}
                                {column.editable ? " editable" : " read-only"}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {databaseRows.map((row) => {
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
                                          className="cell-readonly"
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
                                          {serializeCellValue(value) || (
                                            <span style={{ color: "var(--text-tertiary)" }}>
                                              Empty
                                            </span>
                                          )}
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
                        onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                      />
                      <p className="field-help">
                        Expected columns: `supplier_name`, `supplier_sku`, and `project_price`.
                      </p>
                    </label>

                    <div className="project-chip-row">
                      <span className="database-chip">
                        Project: {selectedProject?.name ?? "none selected"}
                      </span>
                      {selectedProjectLocation && (
                        <span className="database-chip">Location: {selectedProjectLocation}</span>
                      )}
                      <span className="database-chip">
                        Approval flow: project manager review required
                      </span>
                    </div>

                    <div className="button-row">
                      <button type="submit" disabled={isProjectPriceUploading}>
                        {isProjectPriceUploading ? "Matching prices..." : "Preview project prices"}
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={
                          isProjectPriceUploading ||
                          !selectedFile ||
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
                          !selectedFile ||
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
                              <td>{row.currentContractPrice ?? "---"}</td>
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
                className={`stat-card ${orderStatusFilter === "approved" ? "active" : ""}`}
                onClick={() =>
                  setOrderStatusFilter((current) => (current === "approved" ? "all" : "approved"))
                }
              >
                <span className="stat-label">Approved</span>
                <strong>{orderStatusCounts.approved}</strong>
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
                  Status:{" "}
                  {orderStatusFilter === "all" ? "All statuses" : ORDER_STATUS_LABELS[orderStatusFilter]}
                </span>
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
                  {filteredOrders.map((order) => (
                    <article
                      className={`order-card ${
                        order.status === "pending_approval" ? "approval-needed" : ""
                      }`}
                      key={order.id}
                    >
                      <div className="order-card-header">
                        <div>
                          <strong>{order.projectName}</strong>
                          <p>{order.foremanName}</p>
                        </div>
                        <div className="order-card-statuses">
                          {order.status === "pending_approval" ? (
                            <span className="order-attention-badge">Approval needed</span>
                          ) : null}
                          <span className={`status-pill ${order.status.replace("_", "-")}`}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>
                        </div>
                      </div>

                      <div className="order-card-meta">
                        <span>Order sum: {order.totalAmount.toFixed(2)} {order.currency}</span>
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
                                  {item.quantity} x {item.unitPrice.toFixed(2)} CHF = {item.lineTotal.toFixed(2)} CHF
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
                        {order.status === "approved" ? (
                          <button
                            type="button"
                            disabled={savingOrderId === order.id}
                            onClick={() => void updateOrderStatus(order.id, "mark_ordered")}
                          >
                            {savingOrderId === order.id ? "Updating..." : "Mark ordered"}
                          </button>
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
                    </article>
                  ))}
                </div>
              )}
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
                  No catalog rows match the current supplier, category, and subcategory filters.
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
                              <strong>{item.supplierName}</strong>
                              <span className="subline">{item.supplierSku}</span>
                            </td>
                            <td>
                              <input
                                value={row.displayName}
                                onChange={(event) =>
                                  updateDraftValue(item.id, "displayName", event.target.value)
                                }
                              />
                              <span className="subline">Source: {item.sourceName}</span>
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
                                Subcategory: {item.subcategory || "n/a"}
                              </span>
                              <span className="subline">Source: {item.sourceCategory || "n/a"}</span>
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
                              <span className="subline">{item.unit}</span>
                            </td>
                            <td>
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={row.isCMaterial}
                                  onChange={(event) =>
                                    updateDraftValue(item.id, "isCMaterial", event.target.checked)
                                  }
                                />
                                <span>{row.isCMaterial ? "Allowed" : "Blocked"}</span>
                              </label>
                            </td>
                            <td>
                              <span className="subline">Use: {item.consumptionType || "n/a"}</span>
                              <span className="subline">Site: {item.typicalSite || "n/a"}</span>
                              <span className="subline">Family: {item.familyName || "n/a"}</span>
                              <span className="subline">Variant: {item.variantLabel || "standard"}</span>
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
