import cors from "cors";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import type { CsvUploadResponse, CsvRecordValue } from "@comstruct/shared";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/uploads/csv", upload.single("file"), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "No CSV file was uploaded." });
    return;
  }

  try {
    const fileContent = request.file.buffer.toString("utf-8");
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Array<Record<string, CsvRecordValue>>;

    const columns = Object.keys(records[0] ?? {});
    const previewRows = records.slice(0, 5);

    const payload: CsvUploadResponse = {
      fileName: request.file.originalname,
      totalRows: records.length,
      columns,
      previewRows
    };

    response.json(payload);
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "The CSV file could not be parsed."
    });
  }
});

const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`Comstruct API listening on http://localhost:${port}`);
});

