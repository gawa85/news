import { createHash } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { slugify, type FeedSource, type Outlet, type OutletKind, type Owner, type OwnershipRecord, type User } from "../../domain/model";
import type { IArticleReader, IAuthorizationService, ICatalogRepository, IClock, ICountryRegistry, IDomainEvents, IJobQueue, IOutletReader, IOutletWriter, IUserRepository } from "../../domain/ports";
import { countByTopic, type FeedReadOutcome, type TopicCount } from "./CatalogUseCases";

export const OUTLET_KINDS: OutletKind[] = ["newspaper", "digital", "tv", "radio", "wire_agency", "official"];

export interface OutletDraft {
  /** Sin id, es un medio nuevo (el id sale del nombre). */
  id?: string;
  name: string;
  url: string;
  kind: OutletKind;
  region: { country: string; province?: string; locality?: string };
  aliases?: string[];
}

/** Lo último que se leyó de un medio: para ver que la lectura anda y cómo se clasificó. */
export interface OutletArticles {
  latest: { id: string; title: string; url: string; topic: string; publishedAt: Date }[];
  /** Todas las notas guardadas del medio, por tema. */
  byTopic: TopicCount[];
  total: number;
}

export interface OutletRecord {
  outlet: Outlet;
  feeds: FeedSource[];
  ownership: (OwnershipRecord & { ownerName: string })[];
}

const WEB = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * EDITAR UN MEDIO (permiso `outlets:write`): sus datos y sus feeds, uno por uno. La propiedad y
 * la pauta se cargan por importación (cada dato con su fuente); acá sólo se ven.
 * REGLAS:
 *  - El id de un medio no cambia (lo usan las notas, veredictos y réplicas).
 *  - URL del sitio y de cada feed: http(s). Los feeds se descargan sólo de destinos públicos.
 *  - El país tiene que estar habilitado en la plataforma.
 *  - Un feed no se borra: se desactiva (queda su historial de errores).
 */
export class OutletEditor {
  constructor(
    private readonly outlets: IOutletReader & IOutletWriter,
    private readonly catalog: ICatalogRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly countries?: ICountryRegistry,
    /** Leer a mano: un feed en el momento, o todos en segundo plano (cola). */
    private readonly reading?: { readFeed(feed: FeedSource): Promise<FeedReadOutcome>; queue: IJobQueue; clock: IClock },
    private readonly articles?: IArticleReader,
  ) {}

  /** Las últimas notas leídas de un medio, con su tema, y cuántas hay de cada tema. */
  async recentArticles(actorId: string, outletId: string, limit = 20): Promise<OutletArticles> {
    await this.editor(actorId);
    if (!(await this.outlets.findById(outletId))) throw new NotFoundError("No existe ese medio.");
    if (!this.articles) return { latest: [], byTopic: [], total: 0 };
    const all = await this.articles.find({ outletId });
    const latest = await this.articles.latest(outletId, Math.min(Math.max(1, limit), 50));
    return {
      latest: latest.map((a) => ({ id: a.id, title: a.title, url: a.url, topic: a.topic, publishedAt: a.publishedAt })),
      byTopic: countByTopic(all),
      total: all.length,
    };
  }

  /** "Leer ahora" un feed. Como mucho una vez por minuto (haya salido bien o mal): no se castiga al sitio. */
  async readFeedNow(actorId: string, outletId: string, feedId: string): Promise<FeedReadOutcome & { feed: FeedSource }> {
    await this.editor(actorId);
    if (!this.reading) throw new ValidationError("La lectura de feeds no está configurada.");
    const feed = (await this.catalog.findFeeds(outletId)).find((f) => f.id === feedId);
    if (!feed) throw new NotFoundError("No existe ese feed.");
    if (!feed.active) throw new ValidationError("El feed está desactivado: activalo primero.");
    const last = feed.lastAttemptAt ?? feed.lastFetchedAt;
    if (last && this.reading.clock.now().getTime() - last.getTime() < 60_000) throw new ConflictError("Se leyó hace menos de un minuto. Probá de nuevo en un rato.");
    const r = await this.reading.readFeed(feed);
    const updated = (await this.catalog.findFeeds(outletId)).find((f) => f.id === feedId) ?? feed;
    return { ...r, feed: updated };
  }

  /** "Leer todos los feeds ahora": va a la cola (no deja la pantalla esperando). Una vez cada 5 minutos. */
  async readAllNow(actorId: string): Promise<{ queued: boolean }> {
    const actor = await this.editor(actorId);
    if (!this.reading) throw new ValidationError("La lectura de feeds no está configurada.");
    const window = Math.floor(this.reading.clock.now().getTime() / 300_000);
    const job = await this.reading.queue.enqueue("ingest_feeds", { requestedBy: actor.id }, { dedupeKey: `ingest_feeds:manual:${window}`, maxAttempts: 1 });
    return { queued: !!job };
  }

  async get(actorId: string, outletId: string): Promise<OutletRecord> {
    await this.editor(actorId);
    const outlet = await this.outlets.findById(outletId);
    if (!outlet) throw new NotFoundError("No existe ese medio.");
    const ownership = await this.catalog.findOwnership(outlet.id);
    const owners: Owner[] = ownership.length ? await this.catalog.findOwners([...new Set(ownership.map((o) => o.ownerId))]) : [];
    return {
      outlet,
      feeds: await this.catalog.findFeeds(outlet.id),
      ownership: ownership.map((o) => ({ ...o, ownerName: owners.find((w) => w.id === o.ownerId)?.name ?? o.ownerId })),
    };
  }

  async save(actorId: string, draft: OutletDraft): Promise<Outlet> {
    const actor = await this.editor(actorId);
    const name = text(draft.name, 150);
    const url = text(draft.url, 500);
    if (!name) throw new ValidationError("Falta el nombre del medio.");
    if (!WEB.test(url)) throw new ValidationError("La dirección del sitio tiene que empezar con http:// o https://.");
    if (!OUTLET_KINDS.includes(draft.kind)) throw new ValidationError("Tipo de medio inválido.");
    const country = text(draft.region?.country, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new ValidationError("Falta el país (código de dos letras).");
    if (this.countries && !this.countries.has(country)) throw new ValidationError(`El país ${country} no está habilitado.`);
    const aliases = Array.isArray(draft.aliases) ? [...new Set(draft.aliases.map((a) => text(a, 150)).filter((a) => a && a !== name))].slice(0, 20) : [];

    let id: string;
    if (draft.id) {
      if (!(await this.outlets.findById(draft.id))) throw new NotFoundError("No existe ese medio.");
      id = draft.id;
    } else {
      id = slugify(name);
      if (!id) throw new ValidationError("El nombre necesita letras o números.");
      if (await this.outlets.findById(id)) throw new ConflictError(`Ya existe un medio con el id "${id}".`);
    }
    const outlet: Outlet = {
      id, name, url, kind: draft.kind,
      region: { country, province: text(draft.region?.province, 100) || undefined, locality: text(draft.region?.locality, 100) || undefined },
      aliases: aliases.length ? aliases : undefined,
    };
    await this.outlets.save(outlet);
    await this.events.emit("outlet.saved", { userId: actor.id }, { created: !draft.id }, { type: "outlet", id });
    return outlet;
  }

  async addFeed(actorId: string, outletId: string, feedUrl: string): Promise<FeedSource> {
    const actor = await this.editor(actorId);
    if (!(await this.outlets.findById(outletId))) throw new NotFoundError("No existe ese medio.");
    const url = text(feedUrl, 500);
    if (!WEB.test(url)) throw new ValidationError("La dirección del feed tiene que empezar con http:// o https://.");
    const existing = (await this.catalog.findFeeds(outletId)).find((f) => f.url === url);
    const feed: FeedSource = existing ? { ...existing, active: true } : { id: `feed:${outletId}:${createHash("sha256").update(url).digest("hex").slice(0, 10)}`, outletId, url, active: true };
    await this.catalog.saveFeed(feed);
    await this.events.emit("outlet.feed_changed", { userId: actor.id }, { feedId: feed.id, active: true }, { type: "outlet", id: outletId });
    return feed;
  }

  async setFeedActive(actorId: string, outletId: string, feedId: string, active: boolean): Promise<FeedSource> {
    const actor = await this.editor(actorId);
    const feed = (await this.catalog.findFeeds(outletId)).find((f) => f.id === feedId);
    if (!feed) throw new NotFoundError("No existe ese feed.");
    const next = { ...feed, active };
    await this.catalog.saveFeed(next);
    await this.events.emit("outlet.feed_changed", { userId: actor.id }, { feedId, active }, { type: "outlet", id: outletId });
    return next;
  }

  private async editor(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("outlets:write")) throw new AccessDeniedError("No tenés permiso para editar medios.", "no_permission");
    return u;
  }
}
