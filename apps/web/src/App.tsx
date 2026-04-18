import { useState } from "react";
import type { CsvUploadResponse } from "@comstruct/shared";

const API_URL = "http://localhost:4000/api/uploads/csv";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvUploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Choose a CSV file before uploading.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as CsvUploadResponse | { error: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Upload failed.");
      }

      setResult(data);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Comstruct</p>
        <h1>Upload CSV files and turn them into structured data workflows.</h1>
        <p className="lede">
          This starter gives us a web app for uploads and a backend API that parses CSVs,
          previews rows, and sets us up for validation, storage, and downstream processing.
        </p>
      </section>

      <section className="panel">
        <form onSubmit={handleSubmit} className="upload-form">
          <label className="upload-label">
            <span>CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          <button type="submit" disabled={isUploading}>
            {isUploading ? "Uploading..." : "Upload CSV"}
          </button>
        </form>

        {error ? <p className="status error">{error}</p> : null}

        {result ? (
          <div className="result-grid">
            <article className="stat-card">
              <span className="stat-label">Filename</span>
              <strong>{result.fileName}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Rows</span>
              <strong>{result.totalRows}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Columns</span>
              <strong>{result.columns.length}</strong>
            </article>

            <article className="preview-card">
              <h2>Detected columns</h2>
              <div className="pill-row">
                {result.columns.map((column) => (
                  <span key={column} className="pill">
                    {column}
                  </span>
                ))}
              </div>
            </article>

            <article className="preview-card">
              <h2>Preview rows</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.previewRows.map((row, index) => (
                      <tr key={index}>
                        {result.columns.map((column) => (
                          <td key={column}>{String(row[column] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}

