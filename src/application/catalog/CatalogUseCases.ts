import { AccessDeniedError, NotFoundError } from "../../domain/errors";
import { normalizeRegion, stableArticleId, type Article, type FeedSource, type ImportReport } from "../../domain/model";
import type {
  IArticleWriter,
  IAuthorizationService,
  ICatalogRepository,
  IClaimExtractor,
  IClaimWriter,
  IClock,
  ICountryRegistry,
  IDomainEvents,
  IFeedReader,
  ILogger,
  IOutletCatalogSource,
  IOutletReader,
  IOutletWriter,
  ITopicClassifier,
  IUserRepository,
} from "../../domain/ports";

/**
 * IMPORTAR EL CATÁLOGO desde una fuente (CSV propio, datos abiertos de pauta, registro de propiedad).
 * REGLAS: permiso `outlets:write`; se rechazan montos negativos, URLs inválidas y fechas imposibles;
 * se informan las filas que no se pudieron asociar a un medio (para revisarlas a mano);
 * cada dato guarda su fuente.
 */
export class ImportCatalogUseCase {
  constructor(
    private readonly configured: IOutletCatalogSource[],
    private readonly catalog: ICatalogRepository,
    private readonly outlets: IOutletReader & IOutletWriter,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly countries?: ICountryRegistry,
  ) {}

  /** Fuentes configuradas en el servidor (datos abiertos, registros públicos…). */
  async sources(actorId: string): Promise<{ id: string; label: string }[]> {
    await this.editor(actorId);
    return this.configured.map((s) => ({ id: s.id, label: s.label }));
  }

  async execute(input: { actorId: string; sourceId: string; extraSources?: IOutletCatalogSource[] }): Promise<ImportReport> {
    const actor = await this.editor(input.actorId);
    const source = [...this.configured, ...(input.extraSources ?? [])].find((s) => s.id === input.sourceId);
    if (!source) throw new NotFoundError(`No existe la fuente ${input.sourceId}.`);

    const batch = await source.load({ outlets: await this.outlets.findAll() });
    const rejected: string[] = [];
    const warnings: string[] = [];
    const report: ImportReport = { sourceId: source.id, outlets: 0, owners: 0, ownership: 0, advertising: 0, feeds: 0, unmatched: batch.unmatched ?? [], rejected, warnings };

    for (const o of batch.outlets ?? []) {
      if (!/^https?:\/\/\S+$/.test(o.url)) rejected.push(`Medio ${o.id}: URL inválida`);
      else {
        await this.outlets.save(o);
        report.outlets++;
        // Regiones por país: una provincia mal escrita arruina el cruce con la coyuntura local.
        if (this.countries) {
          if (!this.countries.has(o.region.country)) warnings.push(`Medio ${o.id}: país ${o.region.country} no habilitado.`);
          else if (o.region.province && !this.countries.get(o.region.country).regions.some((r) => normalizeRegion(r.name) === normalizeRegion(o.region.province!))) {
            warnings.push(`Medio ${o.id}: "${o.region.province}" no es una región de ${this.countries.get(o.region.country).name}.`);
          }
        }
      }
    }
    for (const f of batch.feeds ?? []) {
      if (!/^https?:\/\/\S+$/.test(f.url)) rejected.push(`Feed de ${f.outletId}: URL inválida`);
      else (await this.catalog.saveFeed(f), report.feeds++);
    }
    for (const o of batch.owners ?? []) (await this.catalog.saveOwner(o), report.owners++);
    for (const r of batch.ownership ?? []) {
      if (Number.isNaN(r.since.getTime()) || (r.until && r.until < r.since)) rejected.push(`Propiedad ${r.outletId}/${r.ownerId}: fechas inválidas`);
      else (await this.catalog.saveOwnership(r), report.ownership++);
    }
    for (const a of batch.advertising ?? []) {
      if (!Number.isFinite(a.amount) || a.amount < 0) rejected.push(`Pauta ${a.outletId}/${a.payer}: monto inválido`);
      else if (Number.isNaN(a.period.from.getTime()) || a.period.to < a.period.from) rejected.push(`Pauta ${a.outletId}/${a.payer}: período inválido`);
      else (await this.catalog.saveAdvertising(a), report.advertising++);
    }
    await this.events.emit("catalog.imported", { userId: actor.id }, { source: source.id, ...report, unmatched: report.unmatched.length, rejected: rejected.length });
    return report;
  }

  private async editor(actorId: string) {
    const actor = await this.users.findById(actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("outlets:write")) throw new AccessDeniedError("No tenés permiso para cargar el catálogo.", "no_permission");
    return actor;
  }
}

/**
 * INGESTA DE NOTICIAS REALES: lee los feeds de los medios del catálogo, clasifica cada
 * nota por tema, la guarda (sin duplicar) y extrae sus afirmaciones.
 * Es un trabajo periódico; un feed caído no frena a los demás.
 */
export class IngestFeedsUseCase {
  constructor(
    private readonly catalog: ICatalogRepository,
    private readonly outlets: IOutletReader,
    private readonly reader: IFeedReader,
    private readonly classifier: ITopicClassifier,
    private readonly articles: IArticleWriter,
    private readonly extractor: IClaimExtractor,
    private readonly claims: IClaimWriter,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly maxPerFeed = 50,
  ) {}

  /** Lo corre la cola cada 30 minutos: todos los feeds activos. */
  async execute(): Promise<{ feeds: number; articles: number; errors: number }> {
    let total = 0;
    let errors = 0;
    const feeds = await this.catalog.findActiveFeeds();
    for (const feed of feeds) {
      const r = await this.readFeed(feed);
      total += r.articles;
      if (r.error) errors++;
    }
    return { feeds: feeds.length, articles: total, errors };
  }

  /** Lee UN feed: guarda las notas nuevas (sin duplicar) y sus afirmaciones. Un error queda en el feed. */
  async readFeed(feed: FeedSource): Promise<{ articles: number; error?: string }> {
    try {
      const outlet = await this.outlets.findById(feed.outletId);
      if (!outlet) throw new Error("medio inexistente");
      const since = feed.lastFetchedAt ?? new Date(0);
      const fresh: Article[] = [];
      for (const e of (await this.reader.read(feed.url)).filter((x) => x.link && x.publishedAt > since).slice(0, this.maxPerFeed)) {
        fresh.push({
          id: stableArticleId(e.link!), outletId: outlet.id, url: e.link!, title: e.title, body: e.text,
          publishedAt: e.publishedAt, region: outlet.region, topic: (await this.classifier.classify(`${e.title}. ${e.text}`)) ?? "otros",
        });
      }
      await this.articles.saveMany(fresh);
      for (const a of fresh) await this.claims.saveMany(await this.extractor.extract(a));
      await this.catalog.saveFeed({ ...feed, lastFetchedAt: this.clock.now(), lastAttemptAt: this.clock.now(), lastError: undefined });
      return { articles: fresh.length };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // (lastFetchedAt no cambia: es desde cuándo buscar notas; si no, se saltearían las de mientras falló)
      await this.catalog.saveFeed({ ...feed, lastAttemptAt: this.clock.now(), lastError: error });
      this.logger.warn("Falló un feed", { feed: feed.url, error });
      return { articles: 0, error };
    }
  }
}
