import { useEffect, useMemo, useState } from "react";
import {
  CATALOG_STATUSES,
  CSV_IMPORT_TARGETS,
  DATABASE_TABLE,
  DEFAULT_DERIVED_FIELD_MAPPINGS,
  DERIVED_FIELD_TARGETS,
  NORMALIZED_CATEGORIES,
  type CatalogItem,
  type CatalogListResponse,
  type CatalogStatus,
  type ConfirmImportResponse,
  type CsvImportFieldTarget,
  type CsvImportMapping,
  type CsvImportPreviewResponse,
  type DerivedFieldMapping,
  type DerivedFieldTarget,
  type DatabaseColumnDefinition,
  type DatabaseRow,
  type DatabaseTableDefinition,
  type DatabaseTableRowsResponse,
  type ErrorResponse,
  type ImportBatchListResponse,
  type ImportBatchSummary,
  type NormalizedCategory,
} from "@comstruct/shared";

const API_BASE = "http://localhost:4000/api";

type ViewKey = "imports" | "catalog" | "database";

type FilterState = {
  supplier: string;
  catalogStatus: CatalogStatus | "all";
  normalizedCategory: NormalizedCategory | "all";
};

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

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("imports");
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CatalogItem>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportPreviewResponse | null>(null);
  const [mappingDraft, setMappingDraft] = useState<CsvImportMapping[]>([]);
  const [derivedMappingDraft, setDerivedMappingDraft] = useState<DerivedFieldMapping[]>(
    DEFAULT_DERIVED_FIELD_MAPPINGS
  );
  const [customCategories, setCustomCategories] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    supplier: "all",
    catalogStatus: "all",
    normalizedCategory: "all",
  });
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
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [isDatabaseLoading, setIsDatabaseLoading] = useState(false);
  const [savingDatabaseRowId, setSavingDatabaseRowId] = useState<string | null>(null);

  async function loadImports() {
    const response = await fetch(`${API_BASE}/imports`);
    const payload = await readJson<ImportBatchListResponse>(response);
    setImports(payload.imports);
  }

  async function loadCatalog() {
    const query = new URLSearchParams();

    if (filters.supplier !== "all") {
      query.set("supplier", filters.supplier);
    }

    if (filters.catalogStatus !== "all") {
      query.set("catalogStatus", filters.catalogStatus);
    }

    if (filters.normalizedCategory !== "all") {
      query.set("normalizedCategory", filters.normalizedCategory);
    }

    const response = await fetch(`${API_BASE}/catalog-items?${query.toString()}`);
    const payload = await readJson<CatalogListResponse>(response);
    setCatalogItems(payload.items);
  }

  async function loadDatabaseRows() {
    setIsDatabaseLoading(true);

    try {
      const response = await fetch(`${API_BASE}/database/tables/${DATABASE_TABLE}/rows`);
      const payload = await readJson<DatabaseTableRowsResponse>(response);
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
        await Promise.all([loadImports(), loadCatalog()]);
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
    void (async () => {
      try {
        await loadCatalog();
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "The catalog could not be loaded."
        );
      }
    })();
  }, [filters]);

  const supplierOptions = useMemo(
    () => Array.from(new Set(catalogItems.map((item) => item.supplierName))).sort(),
    [catalogItems]
  );

  const statusCounts = useMemo(
    () =>
      CATALOG_STATUSES.reduce<Record<CatalogStatus, number>>(
        (accumulator, status) => ({
          ...accumulator,
          [status]: catalogItems.filter((item) => item.catalogStatus === status).length,
        }),
        {
          imported: 0,
          published: 0,
          excluded: 0,
        }
      ),
    [catalogItems]
  );

  const databaseDraftCount = useMemo(
    () => Object.keys(databaseDrafts).length,
    [databaseDrafts]
  );

  const activeDatabaseColumnFilterCount = useMemo(
    () =>
      Object.values(databaseColumnFilters).filter((values) => values.length > 0).length,
    [databaseColumnFilters]
  );

  const databaseColumnFilterOptions = useMemo(() => {
    if (!selectedTable) {
      return {} as Record<string, string[]>;
    }

    return Object.fromEntries(
      selectedTable.columns.map((column) => {
        const options = Array.from(
          new Set(databaseRows.map((row) => serializeCellValue(row[column.name]) || "null"))
        ).sort((left, right) => left.localeCompare(right));

        return [column.name, options];
      })
    ) as Record<string, string[]>;
  }, [databaseRows, selectedTable]);

  const filteredDatabaseRows = useMemo(() => {
    if (!selectedTable) {
      return databaseRows;
    }

    const normalizedSearch = databaseSearchQuery.trim().toLowerCase();

    return databaseRows.filter((row) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        selectedTable.columns.some((column) =>
          serializeCellValue(row[column.name]).toLowerCase().includes(normalizedSearch)
        );

      if (!matchesSearch) {
        return false;
      }

      return selectedTable.columns.every((column) => {
        const selectedValues = databaseColumnFilters[column.name] ?? [];
        if (selectedValues.length === 0) {
          return true;
        }

        const cellValue = serializeCellValue(row[column.name]) || "null";
        return selectedValues.includes(cellValue);
      });
    });
  }, [databaseColumnFilters, databaseRows, databaseSearchQuery, selectedTable]);

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

    if (customCategories) {
      formData.append("customCategories", customCategories);
    }

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
          customCategories,
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

  async function saveCatalogItem(itemId: string) {
    const draft = drafts[itemId];
    const current = catalogItems.find((item) => item.id === itemId);

    if (!draft || !current) {
      return;
    }

    setSavingItemId(itemId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/catalog-items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName: draft.displayName,
          normalizedCategory: draft.normalizedCategory,
          unitPrice: draft.unitPrice,
          isCMaterial: draft.isCMaterial,
          catalogStatus: draft.catalogStatus,
        }),
      });

      const updated = await readJson<CatalogItem>(response);
      setCatalogItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      setDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[itemId];
        return nextDrafts;
      });
      setSuccess(`"${updated.displayName}" was updated.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "The catalog item could not be saved."
      );
    } finally {
      setSavingItemId(null);
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
        `${API_BASE}/database/tables/${DATABASE_TABLE}/rows/${rowId}`,
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
        />
      );
    }

    return (
      <input
        key={column.name}
        value={serializeCellValue(value)}
        onChange={(event) => updateDatabaseDraft(rowId, column.name, event.target.value)}
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

  const headerCopy =
    activeView === "imports"
      ? {
          tag: "Supplier Import Review",
          title:
            "Upload supplier CSV files, verify field mapping, then publish into the procurement catalog.",
        }
      : activeView === "catalog"
        ? {
            tag: "Catalog Stewardship",
            title: "Clean product names, normalize categories, and decide what is published.",
          }
        : {
            tag: "Supabase Data Manager",
            title:
              "Browse the live normalized_products table in Supabase and update row values directly.",
          };

  const viewNavigation = [
    {
      key: "imports" as const,
      label: "Import",
      description: "CSV uploads, field mapping, AI preview",
      count: imports.length,
    },
    {
      key: "catalog" as const,
      label: "Catalog",
      description: "Cleanup queue and publishing decisions",
      count: catalogItems.length,
    },
    {
      key: "database" as const,
      label: "Database",
      description: "Direct row editing in normalized_products",
      count: 1,
    },
  ];

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            C
          </div>
          <div>
            <p className="eyebrow">Comstruct</p>
            <h1>Procurement workspace</h1>
            <p className="sidebar-copy">
              Import supplier data, review catalog output, and correct database records from
              one place.
            </p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace sections">
          <div className="sidebar-section-title">Functions</div>
          {viewNavigation.map((item) => (
            <button
              key={item.key}
              className={activeView === item.key ? "nav-button active" : "nav-button"}
              onClick={() => setActiveView(item.key)}
              type="button"
            >
              <span className="nav-button-main">
                <span className="nav-icon">
                  <SidebarIcon view={item.key} />
                </span>
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </span>
              <span>{item.count}</span>
            </button>
          ))}
        </nav>

        <section className="sidebar-card">
          <span className="sidebar-card-label">Current Workspace</span>
          <strong>Tail-spend procurement control</strong>
          <p>
            This workspace is focused on C-material data quality: import, normalize,
            validate, and correct before operational use.
          </p>
        </section>
      </aside>

      <section className="workspace-main">
        <header className="page-header">
          <div>
            <p className="section-tag">{headerCopy.tag}</p>
            <h2>{headerCopy.title}</h2>
          </div>

          {activeView === "database" ? (
            <div className="header-stats">
              <article>
                <span>Table</span>
                <strong>1</strong>
              </article>
              <article>
                <span>Visible Rows</span>
                <strong>{filteredDatabaseRows.length}</strong>
              </article>
              <article>
                <span>Draft Rows</span>
                <strong>{databaseDraftCount}</strong>
              </article>
            </div>
          ) : (
            <div className="header-stats">
              <article>
                <span>Imported</span>
                <strong>{statusCounts.imported}</strong>
              </article>
              <article>
                <span>Published</span>
                <strong>{statusCounts.published}</strong>
              </article>
              <article>
                <span>Excluded</span>
                <strong>{statusCounts.excluded}</strong>
              </article>
            </div>
          )}
        </header>

        {error ? <p className="banner error">{error}</p> : null}
        {success ? <p className="banner success">{success}</p> : null}

        {activeView === "imports" ? (
          <section className="content-grid">
            <article className="panel upload-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Import flow</p>
                  <h3>Upload supplier CSV</h3>
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
                  <span>Unterkategorien</span>
                  <textarea
                    value={customCategories}
                    onChange={(event) => setCustomCategories(event.target.value)}
                    placeholder="Befestigung - Schrauben, Elektro - Kabel und Leitungen, PSA - Handschutz"
                    className="field-textarea"
                  />
                  <p className="field-help">
                    Erlaubte Enum-Werte als kommagetrennte oder zeilengetrennte Liste eingeben.
                  </p>
                </label>

                <div className="button-row">
                  <button type="submit" disabled={isUploading}>
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

              <section className="recent-imports">
                <div className="panel-subheader">
                  <h4>Recent import batches</h4>
                  <span>{imports.length}</span>
                </div>

                {imports.length === 0 ? (
                  <p className="empty-state">No imports yet.</p>
                ) : (
                  <div className="import-list">
                    {imports.slice(0, 5).map((importBatch) => (
                      <article className="import-card" key={importBatch.id}>
                        <div>
                          <strong>{importBatch.fileName}</strong>
                          <p>{importBatch.totalRows} rows</p>
                        </div>
                        <span className={`status-pill ${importBatch.status}`}>
                          {importBatch.status}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </section>
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
        ) : activeView === "catalog" ? (
          <section className="catalog-layout">
            <article className="panel filter-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Catalog filters</p>
                  <h3>Focus the cleanup queue</h3>
                </div>
              </div>

              <div className="filters">
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
                  <span>Status</span>
                  <select
                    value={filters.catalogStatus}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        catalogStatus: event.target.value as CatalogStatus | "all",
                      }))
                    }
                  >
                    <option value="all">All statuses</option>
                    {CATALOG_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
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
              </div>
            </article>

            <article className="panel catalog-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Cleanup queue</p>
                  <h3>Review imported products</h3>
                </div>
              </div>

              {catalogItems.length === 0 ? (
                <p className="empty-state">
                  The catalog is empty. Confirm an import from the Imports tab first.
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
                        <th>Status</th>
                        <th>Meta</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalogItems.map((item) => {
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
                              <span className="subline">{item.sourceCategory}</span>
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
                              <select
                                value={row.catalogStatus}
                                onChange={(event) =>
                                  updateDraftValue(
                                    item.id,
                                    "catalogStatus",
                                    event.target.value as CatalogStatus
                                  )
                                }
                              >
                                {CATALOG_STATUSES.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
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
                            <td>
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={savingItemId === item.id}
                                onClick={() => void saveCatalogItem(item.id)}
                              >
                                {savingItemId === item.id ? "Saving..." : "Save"}
                              </button>
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
        ) : (
          <section className="database-layout">
            <article className="panel database-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-eyebrow">Live rows</p>
                  <h3>{selectedTable?.label ?? "Normalized Products"}</h3>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void loadDatabaseRows()}
                >
                  Refresh
                </button>
              </div>

              {selectedTable ? (
                <div className="database-summary">
                  <p>{selectedTable.description}</p>
                  <div className="database-summary-meta">
                    <span>Supabase table: {DATABASE_TABLE}</span>
                    <span>Primary key: {selectedTable.primaryKey}</span>
                    <span>Rows loaded: {databaseRowCount}</span>
                    <span>Rows visible: {filteredDatabaseRows.length}</span>
                    <span>Editable columns: {selectedTable.columns.filter((c) => c.editable).length}</span>
                  </div>
                </div>
              ) : null}

              {selectedTable ? (
                <section className="database-controls">
                  <label className="field database-search-field">
                    <span>Search all columns</span>
                    <input
                      value={databaseSearchQuery}
                      onChange={(event) => setDatabaseSearchQuery(event.target.value)}
                      placeholder="Search IDs, categories, product names, packaging, storage..."
                    />
                  </label>

                  <div className="database-controls-meta">
                    <span className="database-chip">
                      {activeDatabaseColumnFilterCount} column filters active
                    </span>
                    <span className="database-chip">
                      {filteredDatabaseRows.length} matching rows
                    </span>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={clearDatabaseFilters}
                      disabled={
                        databaseSearchQuery.trim().length === 0 &&
                        activeDatabaseColumnFilterCount === 0
                      }
                    >
                      Clear filters
                    </button>
                  </div>
                </section>
              ) : null}

              {!selectedTable ? (
                <p className="empty-state">The `normalized_products` table could not be loaded.</p>
              ) : isDatabaseLoading ? (
                <p className="empty-state">Loading rows from Supabase...</p>
              ) : databaseRows.length === 0 ? (
                <p className="empty-state">This table is empty.</p>
              ) : filteredDatabaseRows.length === 0 ? (
                <p className="empty-state">
                  No rows match the current search and column filters.
                </p>
              ) : (
                <div className="table-shell">
                  <table className="database-table">
                    <thead>
                      <tr>
                        {selectedTable.columns.map((column) => (
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
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDatabaseRows.map((row) => {
                        const rowId = getRowId(row, selectedTable);
                        const rowDraft = databaseDrafts[rowId];
                        const hasDraft = Boolean(rowDraft && Object.keys(rowDraft).length > 0);

                        return (
                          <tr key={rowId}>
                            {selectedTable.columns.map((column) => {
                              const value = getDatabaseValue(rowId, column.name, row[column.name]);

                              return (
                                <td key={column.name}>
                                  {column.editable ? (
                                    renderDatabaseEditor(column, rowId, value)
                                  ) : (
                                    <div className="cell-readonly">
                                      {serializeCellValue(row[column.name]) || "null"}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
        )}
      </section>
    </main>
  );
}
