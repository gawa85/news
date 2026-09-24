import type { ExportDocument, ExportFile, ExportFormat } from "../model";

/** Convierte un documento neutro a un formato. Uno por formato (CSV, JSON, PDF, XLSX…). */
export interface IExporter {
  readonly format: ExportFormat;
  render(doc: ExportDocument, baseName: string): Promise<ExportFile>;
}
