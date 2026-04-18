import cors from "cors";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import type {
  CatalogListResponse,
  ConfirmProjectPriceImportResponse,
  CreateProjectInput,
  CsvImportMapping,
  CsvImportPreviewResponse,
  DerivedFieldMapping,
  DatabaseTableListResponse,
  DatabaseTableRowsResponse,
  ErrorResponse,
  ImportBatchListResponse,
  ProjectPriceImportMapping,
  ProcurementOrderActionInput,
  ProcurementOrderCreateInput,
  ProcurementOrderSettings,
  ProcurementOrdersResponse,
  ProjectPriceImportPreviewResponse,
  ProjectsListResponse,
  UpdateCatalogItemInput,
  UpdateDatabaseRowInput,
} from "@comstruct/shared";
import {
  buildDefaultMapping,
  sanitizeIncomingMapping,
  validateColumns,
  validateMapping,
} from "./lib/catalog.js";
import {
  ApiError,
  confirmImport,
  confirmProjectPriceImport,
  createProject,
  createCsvImportPreview,
  createProcurementOrder,
  listDatabaseRows,
  listDatabaseTables,
  listCatalogItems,
  listImports,
  listProjects,
  listProcurementOrders,
  previewProjectPriceImport,
  updateProcurementOrderSettings,
  updateProcurementOrderStatus,
  updateCatalogItem,
  updateDatabaseRow,
} from "./lib/supabase.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post(
  "/api/imports/csv",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        throw new ApiError(400, "No CSV file was uploaded.");
      }

      const fileContent = request.file.buffer.toString("utf-8");
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, unknown>>;

      if (records.length === 0) {
        throw new ApiError(400, "The CSV file is empty.");
      }

      const columns = Object.keys(records[0] ?? {});
      const requestedMapping = Array.isArray(request.body.mapping)
        ? (request.body.mapping as CsvImportMapping[])
        : request.body.mapping
          ? (JSON.parse(request.body.mapping as string) as CsvImportMapping[])
          : undefined;
      const requestedDerivedMapping = Array.isArray(request.body.derivedMapping)
        ? (request.body.derivedMapping as DerivedFieldMapping[])
        : request.body.derivedMapping
          ? (JSON.parse(request.body.derivedMapping as string) as DerivedFieldMapping[])
          : undefined;

      const mapping = sanitizeIncomingMapping(
        columns,
        requestedMapping ?? buildDefaultMapping(columns)
      );

      const payload: CsvImportPreviewResponse = await createCsvImportPreview({
        fileName: request.file.originalname,
        rows: records,
        mapping,
        derivedMapping: requestedDerivedMapping,
      });

      response.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

app.post("/api/imports/:id/confirm", async (request, response, next) => {
  try {
    const requestedMapping = Array.isArray(request.body.mapping)
      ? (request.body.mapping as CsvImportMapping[])
      : undefined;
    const requestedDerivedMapping = Array.isArray(request.body.derivedMapping)
      ? (request.body.derivedMapping as DerivedFieldMapping[])
      : undefined;

    const payload = await confirmImport(
      request.params.id,
      requestedMapping,
      requestedDerivedMapping
    );
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/imports", async (_request, response, next) => {
  try {
    const payload: ImportBatchListResponse = await listImports();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects", async (_request, response, next) => {
  try {
    const payload: ProjectsListResponse = {
      projects: await listProjects(),
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    const input = request.body as CreateProjectInput;
    const project = await createProject(input);
    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/project-price-imports/csv",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        throw new ApiError(400, "No CSV file was uploaded.");
      }

      const projectId = String(request.body.projectId ?? "").trim();
      if (!projectId) {
        throw new ApiError(400, "Project selection is required.");
      }
      const requestedMapping = Array.isArray(request.body.mapping)
        ? (request.body.mapping as ProjectPriceImportMapping[])
        : request.body.mapping
          ? (JSON.parse(request.body.mapping as string) as ProjectPriceImportMapping[])
          : undefined;

      const fileContent = request.file.buffer.toString("utf-8");
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, unknown>>;

      if (records.length === 0) {
        throw new ApiError(400, "The CSV file is empty.");
      }

      const payload: ProjectPriceImportPreviewResponse = await previewProjectPriceImport({
        projectId,
        rows: records,
        mapping: requestedMapping,
      });
      response.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/api/project-price-imports/confirm",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        throw new ApiError(400, "No CSV file was uploaded.");
      }

      const projectId = String(request.body.projectId ?? "").trim();
      if (!projectId) {
        throw new ApiError(400, "Project selection is required.");
      }
      const requestedMapping = Array.isArray(request.body.mapping)
        ? (request.body.mapping as ProjectPriceImportMapping[])
        : request.body.mapping
          ? (JSON.parse(request.body.mapping as string) as ProjectPriceImportMapping[])
          : undefined;

      const fileContent = request.file.buffer.toString("utf-8");
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, unknown>>;

      if (records.length === 0) {
        throw new ApiError(400, "The CSV file is empty.");
      }

      const payload: ConfirmProjectPriceImportResponse = await confirmProjectPriceImport({
        projectId,
        rows: records,
        mapping: requestedMapping,
      });
      response.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/catalog-items", async (request, response, next) => {
  try {
    const items = await listCatalogItems({
      supplier:
        typeof request.query.supplier === "string"
          ? request.query.supplier
          : undefined,
      catalogStatus:
        typeof request.query.catalogStatus === "string"
          ? request.query.catalogStatus
          : undefined,
      normalizedCategory:
        typeof request.query.normalizedCategory === "string"
          ? request.query.normalizedCategory
          : undefined,
    });

    const payload: CatalogListResponse = { items };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/catalog-items/:id", async (request, response, next) => {
  try {
    const input = request.body as UpdateCatalogItemInput;
    const item = await updateCatalogItem(request.params.id, input);
    response.json(item);
  } catch (error) {
    next(error);
  }
});

app.get("/api/procurement-orders", async (_request, response, next) => {
  try {
    const payload: ProcurementOrdersResponse = await listProcurementOrders();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/procurement-order-settings", async (request, response, next) => {
  try {
    const input = request.body as ProcurementOrderSettings;
    const payload = await updateProcurementOrderSettings(input);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/procurement-orders", async (request, response, next) => {
  try {
    const input = request.body as ProcurementOrderCreateInput;
    const payload = await createProcurementOrder(input);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/procurement-orders/:id", async (request, response, next) => {
  try {
    const input = request.body as ProcurementOrderActionInput;
    const payload = await updateProcurementOrderStatus(request.params.id, input);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/database/tables", (_request, response, next) => {
  try {
    const payload: DatabaseTableListResponse = {
      tables: listDatabaseTables(),
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/database/tables/:table/rows", async (request, response, next) => {
  try {
    const payload: DatabaseTableRowsResponse = await listDatabaseRows(request.params.table);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/database/tables/:table/rows/:id", async (request, response, next) => {
  try {
    const input = request.body as UpdateDatabaseRowInput;
    const row = await updateDatabaseRow(request.params.table, request.params.id, input);
    response.json(row);
  } catch (error) {
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response<ErrorResponse>,
    _next: express.NextFunction
  ) => {
    if (error instanceof ApiError) {
      response.status(error.status).json({
        error: error.message,
        details: error.details,
      });
      return;
    }

    if (error instanceof Error) {
      response.status(500).json({ error: error.message });
      return;
    }

    response.status(500).json({ error: "Unexpected server error." });
  }
);

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`Comstruct API listening on http://localhost:${port}`);
});
