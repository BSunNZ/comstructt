export type CsvRecordValue = string | number | boolean | null;

export interface CsvUploadResponse {
  fileName: string;
  totalRows: number;
  columns: string[];
  previewRows: Array<Record<string, CsvRecordValue>>;
}
