/**
 * FUENTES PRIMARIAS para verificar datos. Una clase por fuente (OCP).
 */
import type { EvidenceItem, VerificationTask } from "../../domain/model";
import type { IHttpClient, IOfficialDocumentRepository, IPrimarySourceProvider } from "../../domain/ports";
import { normalize } from "../heuristics/text";

type Found = Omit<EvidenceItem, "addedBy" | "addedAt">;

export interface SeriesMapping {
  /** Palabras que, si aparecen en la disputa, indican que esta serie es relevante. */
  keywords: string[];
  seriesId: string;
  label: string;
  unit?: string;
}

/**
 * API de Series de Tiempo de datos.gob.ar (estadísticas oficiales de Argentina).
 * El catálogo palabra clave → serie se CONFIGURA (los ids se buscan en datos.gob.ar);
 * así se agregan series sin tocar código.
 */
export class DatosGobArSeriesProvider implements IPrimarySourceProvider {
  readonly id = "datos_gob_ar_series";
  readonly label = "Series de Tiempo (datos.gob.ar)";

  constructor(
    private readonly http: IHttpClient,
    private readonly catalog: SeriesMapping[],
    private readonly baseUrl = "https://apis.datos.gob.ar/series/api/series/",
  ) {}

  async lookup(task: VerificationTask): Promise<Found[]> {
    const text = normalize(`${task.topic} ${task.question}`);
    const relevant = this.catalog.filter((m) => m.keywords.some((k) => text.includes(normalize(k))));
    const out: Found[] = [];
    for (const m of relevant) {
      const url = `${this.baseUrl}?ids=${encodeURIComponent(m.seriesId)}&last=1&format=json`;
      const res = await this.http.get(url);
      if (res.status !== 200) continue;
      const row = (JSON.parse(res.text) as { data?: [string, number | null][] }).data?.[0];
      if (!row || row[1] === null) continue;
      out.push({ source: this.label, description: `${m.label}: ${row[1]}${m.unit ? ` ${m.unit}` : ""} (dato oficial, ${row[0]})`, url, value: row[1], date: row[0] });
    }
    return out;
  }
}

/**
 * Biblioteca de documentos oficiales cargados por el equipo (resoluciones, informes,
 * presupuestos). Busca en los documentos del tema las cifras que están en disputa.
 */
export class DocumentLibraryProvider implements IPrimarySourceProvider {
  readonly id = "document_library";
  readonly label = "Documentos oficiales";

  constructor(private readonly docs: IOfficialDocumentRepository) {}

  async lookup(task: VerificationTask): Promise<Found[]> {
    const docs = await this.docs.findByTopic(task.topic);
    const out: Found[] = [];
    for (const d of docs) {
      for (const n of task.figures) {
        const pattern = new RegExp(`[^.]*\\b${String(n).replace(".", "[.,]")}\\s*(%|por ciento)[^.]*\\.?`, "i");
        const hit = d.text.match(pattern)?.[0]?.trim();
        if (hit) out.push({ source: `${this.label}: ${d.issuer}`, description: `"${hit}" — ${d.title}`, url: d.url, value: n, date: d.publishedAt.toISOString().slice(0, 10) });
      }
    }
    return out;
  }
}
