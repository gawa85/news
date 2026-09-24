/**
 * CATÁLOGO REAL: medios, dueños, pauta oficial y feeds, cargados desde fuentes
 * (CSV propios o datasets de datos abiertos) y guardados en la base.
 */
import type {
  AdvertisingSpend,
  Article,
  CatalogBatch,
  FeedSource,
  Outlet,
  OutletKind,
  Owner,
  OwnershipRecord,
  Period,
  TopicDefinition,
} from "../../domain/model";
import type {
  IArticleReader,
  ICatalogRepository,
  IHttpClient,
  INewsSearchProvider,
  IOfficialAdvertisingSource,
  IOutletCatalogSource,
  IOwnershipRegistry,
  ITopicClassifier,
  NewsQuery,
  FeedItem,
  IFeedReader,
} from "../../domain/ports";
import { parseFeed } from "../content/RssSource";
import { htmlToText } from "../mail/MailparserMimeParser";
import { normalize } from "../heuristics/text";

// ---------------- Registros leídos desde la base ----------------

export class CatalogOwnershipRegistry implements IOwnershipRegistry {
  constructor(private readonly catalog: ICatalogRepository) {}

  async ownersAt(outletId: string, date: Date): Promise<Owner[]> {
    const ids = (await this.catalog.findOwnership(outletId)).filter((r) => r.since <= date && (!r.until || r.until >= date)).map((r) => r.ownerId);
    return ids.length ? this.catalog.findOwners(ids) : [];
  }
}

export class CatalogAdvertisingSource implements IOfficialAdvertisingSource {
  constructor(private readonly catalog: ICatalogRepository) {}

  spendFor(outletId: string, period: Period): Promise<AdvertisingSpend[]> {
    return this.catalog.findAdvertising(outletId, period);
  }
}

// ---------------- CSV ----------------

/** Lector de CSV tolerante: separador "," o ";", comillas, BOM y saltos de línea dentro de comillas. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => normalize(h).trim().replace(/\s+/g, "_"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** Números con formato argentino ("1.234.567,89") o internacional ("1234567.89"). */
export function parseAmount(s: string): number {
  const t = s.replace(/[^\d,.-]/g, "");
  if (/,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(/,/g, ""));
}

/** Fechas "2026-03-01" o "01/03/2026". */
export function parseDate(s: string): Date {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 3)) : new Date(`${s}T03:00:00Z`);
}

/** Encuentra el medio por nombre o alias (los datasets de pauta suelen usar razones sociales). */
export function matchOutlet(name: string, outlets: Outlet[]): Outlet | undefined {
  const n = normalize(name).replace(/\b(s\.?a\.?|s\.?r\.?l\.?|sa|srl|diario|el|la)\b/g, "").replace(/\W+/g, "");
  if (!n) return undefined;
  return outlets.find((o) => [o.name, ...(o.aliases ?? [])].some((x) => normalize(x).replace(/\b(s\.?a\.?|s\.?r\.?l\.?|sa|srl|diario|el|la)\b/g, "").replace(/\W+/g, "") === n));
}

const slug = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type CsvKind = "outlets" | "ownership" | "advertising";

/**
 * Fuente de catálogo desde un CSV (texto ya descargado o una URL de datos abiertos).
 * Columnas esperadas (en minúsculas, sin tildes):
 *  - outlets:     id, nombre, url, tipo, pais, provincia, localidad, rss, alias (separados por "|")
 *  - ownership:   medio (id o nombre), dueno, sectores ("|"), desde, hasta, fuente
 *  - advertising: medio (id o nombre), pagador, jurisdiccion, monto, moneda, desde, hasta
 */
export class CsvCatalogSource implements IOutletCatalogSource {
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly kind: CsvKind,
    private readonly input: { text: string } | { url: string; http: IHttpClient },
  ) {}

  async load(ctx: { outlets: Outlet[] }): Promise<CatalogBatch> {
    const text = "text" in this.input ? this.input.text : await this.download(this.input.url, this.input.http);
    const rows = parseCsv(text);
    const source = "url" in this.input ? this.input.url : this.label;
    const find = (ref: string) => ctx.outlets.find((o) => o.id === ref) ?? matchOutlet(ref, ctx.outlets);
    const unmatched: string[] = [];

    if (this.kind === "outlets") {
      const outlets: Outlet[] = [];
      const feeds: FeedSource[] = [];
      for (const r of rows) {
        const id = r.id || slug(r.nombre ?? "");
        if (!id || !r.nombre || !r.url) {
          unmatched.push(JSON.stringify(r));
          continue;
        }
        outlets.push({
          id, name: r.nombre, url: r.url, kind: (r.tipo || "digital") as OutletKind,
          region: { country: r.pais || "AR", province: r.provincia || undefined, locality: r.localidad || undefined },
          aliases: r.alias ? r.alias.split("|").map((x) => x.trim()).filter(Boolean) : undefined,
        });
        if (r.rss) feeds.push({ id: `feed:${id}`, outletId: id, url: r.rss, active: true });
      }
      return { outlets, feeds, unmatched };
    }

    if (this.kind === "ownership") {
      const owners = new Map<string, Owner>();
      const ownership: OwnershipRecord[] = [];
      for (const r of rows) {
        const outlet = find(r.medio ?? "");
        if (!outlet || !r.dueno) {
          unmatched.push(r.medio ?? JSON.stringify(r));
          continue;
        }
        const ownerId = slug(r.dueno);
        const sectors = (r.sectores ?? "").split("|").map((x) => x.trim()).filter(Boolean);
        owners.set(ownerId, { id: ownerId, name: r.dueno, businessSectors: [...new Set([...(owners.get(ownerId)?.businessSectors ?? []), ...sectors])] });
        ownership.push({ outletId: outlet.id, ownerId, since: parseDate(r.desde || "1900-01-01"), until: r.hasta ? parseDate(r.hasta) : undefined, source: r.fuente || source });
      }
      return { owners: [...owners.values()], ownership, unmatched };
    }

    const advertising: AdvertisingSpend[] = [];
    for (const r of rows) {
      const outlet = find(r.medio ?? "");
      if (!outlet) {
        unmatched.push(r.medio ?? JSON.stringify(r));
        continue;
      }
      advertising.push({
        outletId: outlet.id,
        payer: r.pagador || "Sin dato",
        jurisdiction: (["national", "provincial", "municipal"].includes(r.jurisdiccion ?? "") ? r.jurisdiccion : r.jurisdiccion === "nacional" ? "national" : r.jurisdiccion === "municipal" ? "municipal" : "provincial") as AdvertisingSpend["jurisdiction"],
        amount: parseAmount(r.monto ?? "0"),
        currency: r.moneda || "ARS",
        period: { from: parseDate(r.desde ?? ""), to: parseDate(r.hasta ?? r.desde ?? "") },
        source,
      });
    }
    return { advertising, unmatched: [...new Set(unmatched)] };
  }

  private async download(url: string, http: IHttpClient): Promise<string> {
    const res = await http.get(url);
    if (res.status !== 200) throw new Error(`No se pudo descargar ${url} (${res.status}).`);
    return res.text;
  }
}

// ---------------- Temas y noticias guardadas ----------------

/** Clasifica por palabras clave (el tema con más coincidencias; empate → el primero). */
export class KeywordTopicClassifier implements ITopicClassifier {
  constructor(private readonly topics: TopicDefinition[]) {}

  async classify(text: string): Promise<string | undefined> {
    const t = normalize(text);
    let best: { name: string; hits: number } | undefined;
    for (const topic of this.topics) {
      const hits = topic.keywords.filter((k) => new RegExp(`\\b${normalize(k)}`).test(t)).length;
      if (hits > 0 && (!best || hits > best.hits)) best = { name: topic.name, hits };
    }
    return best?.name;
  }
}

/** Busca en las notas ya guardadas (las que entraron por los feeds del catálogo). */
export class StoredNewsProvider implements INewsSearchProvider {
  constructor(private readonly articles: IArticleReader) {}

  async search(q: NewsQuery): Promise<Article[]> {
    return (await this.articles.find({ topic: q.topic, period: q.period })).slice(0, q.limit ?? 200);
  }
}

/** Lector de feeds RSS/Atom por HTTP. */
export class HttpFeedReader implements IFeedReader {
  constructor(private readonly http: IHttpClient) {}

  async read(url: string): Promise<FeedItem[]> {
    const res = await this.http.get(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return parseFeed(res.text).map((e) => ({ title: e.title, link: e.link, text: htmlToText(e.body), publishedAt: e.date }));
  }
}
