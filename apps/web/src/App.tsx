import { useEffect, useMemo, useState } from "react";
import {
  CATALOG_STATUSES,
  CSV_IMPORT_TARGETS,
  NORMALIZED_CATEGORIES,
  type CatalogItem,
  type CatalogListResponse,
  type CatalogStatus,
  type ConfirmImportResponse,
  type CsvImportFieldTarget,
  type CsvImportMapping,
  type CsvImportPreviewResponse,
  type ErrorResponse,
  type ImportBatchListResponse,
  type ImportBatchSummary,
  type NormalizedCategory
} from "@comstruct/shared";

const API_BASE = "http://localhost:4000/api";

type ViewKey = "imports" | "catalog";

type FilterState = {
  supplier: string;
  catalogStatus: CatalogStatus | "all";
  normalizedCategory: NormalizedCategory | "all";
};

const TARGET_LABELS: Record<CsvImportFieldTarget | "ignore", string> = {
  supplierSku: "Supplier SKU",
  sourceName: "Product name",
  sourceCategory: "Source category",
  unit: "Unit",
  unitPrice: "Unit price",
  supplierName: "Supplier name",
  consumptionType: "Consumption type",
  hazardous: "Hazardous",
  storageLocation: "Storage location",
  typicalSite: "Typical site",
  ignore: "Ignore"
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

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("imports");
  const [imports, setImports] = useState<ImportBatchSummary[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CatalogItem>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportPreviewResponse | null>(null);
  const [mappingDraft, setMappingDraft] = useState<CsvImportMapping[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    supplier: "all",
    catalogStatus: "all",
    normalizedCategory: "all"
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      try {
        setError(null);
        await Promise.all([loadImports(), loadCatalog()]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "The workspace could not be loaded.");
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadCatalog();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "The catalog could not be loaded.");
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
          [status]: catalogItems.filter((item) => item.catalogStatus === status).length
        }),
        {
          imported: 0,
          published: 0,
          excluded: 0
        }
      ),
    [catalogItems]
  );

  async function uploadCsv(mapping?: CsvImportMapping[]) {
    if (!selectedFile) {
      setError("Bitte zuerst eine CSV-Datei auswählen.");
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

    try {
      const response = await fetch(`${API_BASE}/imports/csv`, {
        method: "POST",
        body: formData
      });

      const payload = await readJson<CsvImportPreviewResponse>(response);
      setPreview(payload);
      setMappingDraft(payload.mapping);
      setSuccess("Import-Preview erstellt. Prüfe jetzt Mapping und Vorschau.");
      await loadImports();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Der CSV-Import ist fehlgeschlagen.");
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mapping: mappingDraft
        })
      });

      const payload = await readJson<ConfirmImportResponse>(response);
      setSuccess(`${payload.importedItems} Produkte wurden in den Katalog übernommen.`);
      setPreview(null);
      setMappingDraft([]);
      setSelectedFile(null);
      setActiveView("catalog");
      await Promise.all([loadImports(), loadCatalog()]);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Der Import konnte nicht bestätigt werden.");
    } finally {
      setIsConfirming(false);
    }
  }

  function updateDraftValue<K extends keyof CatalogItem>(id: string, key: K, value: CatalogItem[K]) {
    setDrafts((currentDrafts) => {
      const base = currentDrafts[id] ?? catalogItems.find((item) => item.id === id);

      if (!base) {
        return currentDrafts;
      }

      return {
        ...currentDrafts,
        [id]: {
          ...base,
          [key]: value
        }
      };
    });
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName: draft.displayName,
          normalizedCategory: draft.normalizedCategory,
          unitPrice: draft.unitPrice,
          isCMaterial: draft.isCMaterial,
          catalogStatus: draft.catalogStatus
        })
      });

      const updated = await readJson<CatalogItem>(response);
      setCatalogItems((items) => items.map((item) => (item.id === itemId ? updated : item)));
      setDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[itemId];
        return nextDrafts;
      });
      setSuccess(`"${updated.displayName}" wurde aktualisiert.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Das Produkt konnte nicht gespeichert werden.");
    } finally {
      setSavingItemId(null);
    }
  }

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div>
          <p className="eyebrow">Comstruct</p>
          <h1>Procurement cleanup cockpit</h1>
          <p className="sidebar-copy">
            Wir verwandeln Supplier-CSV-Dateien in einen bereinigten, steuerbaren
            C-Material-Katalog fur Procurement.
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace sections">
          <button
            className={activeView === "imports" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("imports")}
            type="button"
          >
            Imports
            <span>{imports.length}</span>
          </button>
          <button
            className={activeView === "catalog" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveView("catalog")}
            type="button"
          >
            Catalog
            <span>{catalogItems.length}</span>
          </button>
        </nav>

        <section className="sidebar-card">
          <span className="sidebar-card-label">What this flow is for</span>
          <strong>Small everyday site items</strong>
          <p>
            Consumables, PPE, fastening, electrical accessories and other low-value
            items that procurement wants to clean up before they are exposed in the
            C-material process.
          </p>
        </section>
      </aside>

      <section className="workspace-main">
        <header className="page-header">
          <div>
            <p className="section-tag">
              {activeView === "imports" ? "Supplier Import Review" : "Catalog Stewardship"}
            </p>
            <h2>
              {activeView === "imports"
                ? "Upload sample.csv, verify mapping, then publish into the procurement catalog."
                : "Clean product names, normalize categories, and decide what is published."}
            </h2>
          </div>

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
                  <p className="empty-state">Noch keine Imports vorhanden.</p>
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
                  <button type="button" onClick={() => void confirmCurrentImport()} disabled={isConfirming}>
                    {isConfirming ? "Importing..." : "Import into catalog"}
                  </button>
                ) : null}
              </div>

              {!preview ? (
                <p className="empty-state">
                  Lade `sample.csv` hoch, um die Mapping-Vorschau und die ersten bereinigten
                  Produktzeilen zu sehen.
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

                  <div className="table-shell">
                    <table>
                      <thead>
                        <tr>
                          <th>CSV column</th>
                          <th>Maps to</th>
                          <th>Sample value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappingDraft.map((entry) => (
                          <tr key={entry.sourceColumn}>
                            <td>{entry.sourceColumn}</td>
                            <td>
                              <select
                                value={entry.target}
                                onChange={(event) =>
                                  setMappingDraft((current) =>
                                    current.map((mappingEntry) =>
                                      mappingEntry.sourceColumn === entry.sourceColumn
                                        ? {
                                            ...mappingEntry,
                                            target: event.target.value as CsvImportFieldTarget | "ignore"
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
                            </td>
                            <td>{preview.sampleRow[entry.sourceColumn]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="panel-subheader with-gap">
                    <h4>Normalized preview rows</h4>
                    <span>{preview.previewRows.length}</span>
                  </div>

                  <div className="table-shell">
                    <table>
                      <thead>
                        <tr>
                          <th>Supplier</th>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Category</th>
                          <th>Normalized</th>
                          <th>Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.previewRows.map((row, index) => (
                          <tr key={`${row.supplierSku}-${index}`}>
                            <td>{row.supplierName}</td>
                            <td>{row.supplierSku}</td>
                            <td>{row.sourceName}</td>
                            <td>{row.sourceCategory}</td>
                            <td>
                              <span className="category-pill">{row.normalizedCategory}</span>
                            </td>
                            <td>€ {row.unitPrice.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>
          </section>
        ) : (
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
                        catalogStatus: event.target.value as CatalogStatus | "all"
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
                        normalizedCategory: event.target.value as NormalizedCategory | "all"
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
                  Der Katalog ist noch leer. Bestatige zuerst einen Import aus dem
                  Imports-Tab.
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
                                  updateDraftValue(item.id, "unitPrice", Number(event.target.value))
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
        )}
      </section>
    </main>
  );
}
