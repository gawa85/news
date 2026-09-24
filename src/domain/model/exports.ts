/**
 * EXPORTACIÓN: un documento NEUTRO (título, datos, tablas, notas) que cada
 * exportador convierte a su formato (CSV, JSON, PDF…).
 */
export type ExportFormat = "csv" | "json" | "pdf" | "xlsx";
export type ExportKind = "comparison" | "credibility" | "analysis_history" | "impact" | "audit" | "usage_panel" | "business_kpis";

export interface ExportTable {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface ExportDocument {
  title: string;
  meta: [string, string][];
  tables: ExportTable[];
  notes: string[];
  generatedAt: Date;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  data: Buffer;
}
