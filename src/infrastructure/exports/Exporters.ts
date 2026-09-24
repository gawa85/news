/**
 * EXPORTADORES: uno por formato. Sumar XLSX u ODS = una clase más.
 */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ExportDocument, ExportFile } from "../../domain/model";
import type { IExporter } from "../../domain/ports";

/** CSV compatible con Excel en español: separador ";" y BOM UTF-8 (tildes correctas). */
export class CsvExporter implements IExporter {
  readonly format = "csv" as const;

  async render(doc: ExportDocument, baseName: string): Promise<ExportFile> {
    const cell = (v: string | number | null) => {
      const s = v === null ? "" : String(v);
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const blocks = doc.tables.map((t) => [`# ${t.name}`, t.columns.map(cell).join(";"), ...t.rows.map((r) => r.map(cell).join(";"))].join("\r\n"));
    const header = [`# ${doc.title}`, ...doc.meta.map(([k, v]) => `# ${k}: ${v}`)].join("\r\n");
    const text = [header, ...blocks, ...doc.notes.map((n) => `# ${n}`)].join("\r\n\r\n");
    return { filename: `${baseName}.csv`, contentType: "text/csv; charset=utf-8", data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]) };
  }
}

export class JsonExporter implements IExporter {
  readonly format = "json" as const;

  async render(doc: ExportDocument, baseName: string): Promise<ExportFile> {
    const tables = doc.tables.map((t) => ({ name: t.name, rows: t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? null]))) }));
    const json = { title: doc.title, meta: Object.fromEntries(doc.meta), tables, notes: doc.notes, generatedAt: doc.generatedAt };
    return { filename: `${baseName}.json`, contentType: "application/json; charset=utf-8", data: Buffer.from(JSON.stringify(json, null, 2), "utf8") };
  }
}

/** PDF con pdfkit (sin navegador ni servicios externos). Tablas como listas legibles. */
export class PdfExporter implements IExporter {
  readonly format = "pdf" as const;

  render(doc: ExportDocument, baseName: string): Promise<ExportFile> {
    return new Promise((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 50, info: { Title: doc.title, Producer: "Sin Humo" } });
      const chunks: Buffer[] = [];
      pdf.on("data", (c: Buffer) => chunks.push(c));
      pdf.on("end", () => resolve({ filename: `${baseName}.pdf`, contentType: "application/pdf", data: Buffer.concat(chunks) }));
      pdf.on("error", reject);

      pdf.fontSize(18).text(doc.title).moveDown(0.5);
      pdf.fontSize(9).fillColor("#555").text(`Generado: ${doc.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`);
      for (const [k, v] of doc.meta) pdf.text(`${k}: ${v}`);
      pdf.fillColor("#000");

      for (const t of doc.tables) {
        pdf.moveDown(1).fontSize(13).text(t.name).moveDown(0.3);
        if (!t.rows.length) {
          pdf.fontSize(10).fillColor("#555").text("(sin datos)").fillColor("#000");
          continue;
        }
        for (const r of t.rows) {
          pdf.fontSize(10).text(`• ${t.columns.map((c, i) => `${c}: ${r[i] ?? "-"}`).join("  ·  ")}`, { paragraphGap: 3 });
        }
      }
      if (doc.notes.length) {
        pdf.moveDown(1).fontSize(9).fillColor("#555");
        doc.notes.forEach((n) => pdf.text(n, { paragraphGap: 2 }));
      }
      pdf.end();
    });
  }
}

/**
 * XLSX (Excel) con exceljs: una hoja de resumen y una hoja por tabla, con encabezados
 * en negrita, filtros, primera fila fija y anchos de columna razonables.
 * Los números quedan como números (se pueden sumar y graficar en Excel).
 */
export class XlsxExporter implements IExporter {
  readonly format = "xlsx" as const;

  async render(doc: ExportDocument, baseName: string): Promise<ExportFile> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Sin Humo";
    wb.created = doc.generatedAt;

    const summary = wb.addWorksheet("Resumen");
    summary.addRow([doc.title]).font = { bold: true, size: 14 };
    summary.addRow([]);
    for (const [k, v] of doc.meta) summary.addRow([k, v]);
    summary.addRow(["Generado", doc.generatedAt]);
    summary.getCell(`B${summary.rowCount}`).numFmt = "dd/mm/yyyy hh:mm";
    if (doc.notes.length) {
      summary.addRow([]);
      summary.addRow(["Notas"]).font = { bold: true };
      for (const n of doc.notes) summary.addRow([n]);
    }
    summary.getColumn(1).width = 28;
    summary.getColumn(2).width = 60;

    const used = new Set<string>(["Resumen"]);
    for (const t of doc.tables) {
      const ws = wb.addWorksheet(sheetName(t.name, used));
      const header = ws.addRow(t.columns);
      header.font = { bold: true };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      for (const r of t.rows) ws.addRow(r.map((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v)));
      ws.views = [{ state: "frozen", ySplit: 1 }];
      if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
      t.columns.forEach((c, i) => {
        const longest = Math.max(c.length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length));
        ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
      });
    }
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `${baseName}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data };
  }
}

/** Excel: nombres de hoja de hasta 31 caracteres, sin \ / ? * [ ] : y sin repetir. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Hoja";
  let n = base;
  for (let i = 2; used.has(n); i++) n = `${base.slice(0, 28)} ${i}`;
  used.add(n);
  return n;
}
