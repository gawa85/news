import { AccessDeniedError, ValidationError } from "../../domain/errors";
import type { DirectorySource, SourceConnection, User } from "../../domain/model";
import type { IAuthorizationService, ICatalogRepository, IDomainEvents, IFeedReader, IOutletReader, IOutletWriter, IUserRepository } from "../../domain/ports";
import type { PublicConnection } from "./SourceSettings";

const MAX_PER_REQUEST = 25;
/** Misma dirección aunque cambie "www.", la barra final o mayúsculas. */
const sameUrl = (a: string, b: string) => normalizeUrl(a) === normalizeUrl(b);
const normalizeUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export type UserDirectoryEntry = DirectorySource & { connected: boolean };
export type CatalogDirectoryEntry = DirectorySource & { inCatalog: boolean; feedActive: boolean };
export interface AddResult {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

/**
 * DIRECTORIO DE FUENTES PÚBLICAS CONOCIDAS: elegirlas en vez de escribir la dirección de su feed.
 *  - Para cada persona ("Mis fuentes"): se agregan con el MISMO caso de uso que el formulario
 *    (permiso, plan, límite, prueba del feed y protección de destinos). Una que falla no frena a las demás.
 *  - Para el catálogo general (outlets:write): se carga el medio (si no está) y su feed, de una vez.
 *  - Se puede volver a verificar cada feed (las direcciones cambian).
 */
export class SourceDirectoryService {
  constructor(
    private readonly entries: DirectorySource[],
    private readonly userSources: {
      list(actorId: string): Promise<{ available: boolean; limit: number | null; connections: PublicConnection[] }>;
      connect(input: { actorId: string; type: "rss"; name: string; config: Record<string, string> }): Promise<SourceConnection>;
    },
    private readonly catalog: { outlets: IOutletReader & IOutletWriter; feeds: ICatalogRepository },
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly feedReader?: IFeedReader,
  ) {}

  async forUser(actorId: string): Promise<{ available: boolean; limit: number | null; used: number; entries: UserDirectoryEntry[] }> {
    const mine = await this.userSources.list(actorId);
    const feeds = mine.connections.filter((c) => c.active && c.type === "rss").map((c) => c.config.url ?? "");
    return {
      available: mine.available,
      limit: mine.limit,
      used: mine.connections.filter((c) => c.active).length,
      entries: this.entries.map((e) => ({ ...e, connected: feeds.some((f) => sameUrl(f, e.feedUrl)) })),
    };
  }

  async addForUser(actorId: string, ids: string[]): Promise<{ results: AddResult[] }> {
    const chosen = this.pick(ids);
    const { entries } = await this.forUser(actorId);
    const results: AddResult[] = [];
    for (const e of chosen) {
      if (entries.find((x) => x.id === e.id)?.connected) {
        results.push({ id: e.id, name: e.name, ok: true });
        continue;
      }
      try {
        await this.userSources.connect({ actorId, type: "rss", name: e.name, config: { url: e.feedUrl } });
        results.push({ id: e.id, name: e.name, ok: true });
      } catch (err) {
        results.push({ id: e.id, name: e.name, ok: false, error: err instanceof Error ? err.message : String(err) });
        // Sin permiso o sin lugar en el plan, las que siguen tampoco van a entrar.
        if (err instanceof AccessDeniedError) {
          for (const rest of chosen.slice(chosen.indexOf(e) + 1)) results.push({ id: rest.id, name: rest.name, ok: false, error: err.message });
          break;
        }
      }
    }
    return { results };
  }

  async forCatalog(actorId: string): Promise<CatalogDirectoryEntry[]> {
    await this.editor(actorId);
    const outlets = await this.catalog.outlets.findAll();
    const out: CatalogDirectoryEntry[] = [];
    for (const e of this.entries) {
      const outlet = outlets.find((o) => o.id === e.id || hostOf(o.url) === hostOf(e.site));
      const feeds = outlet ? await this.catalog.feeds.findFeeds(outlet.id) : [];
      out.push({ ...e, inCatalog: !!outlet, feedActive: feeds.some((f) => f.active && sameUrl(f.url, e.feedUrl)) });
    }
    return out;
  }

  /** Carga en el catálogo los medios elegidos (si no están) con su feed activo. */
  async importToCatalog(actorId: string, ids: string[]): Promise<{ outlets: number; feeds: number }> {
    const actor = await this.editor(actorId);
    const all = await this.catalog.outlets.findAll();
    let outlets = 0;
    let feeds = 0;
    for (const e of this.pick(ids)) {
      let outlet = all.find((o) => o.id === e.id || hostOf(o.url) === hostOf(e.site));
      if (!outlet) {
        outlet = { id: e.id, name: e.name, url: e.site, kind: e.kind, region: { country: e.country, province: e.province } };
        await this.catalog.outlets.save(outlet);
        outlets++;
      }
      const existing = (await this.catalog.feeds.findFeeds(outlet.id)).find((f) => sameUrl(f.url, e.feedUrl));
      if (!existing?.active) {
        await this.catalog.feeds.saveFeed(existing ? { ...existing, active: true } : { id: `feed:${outlet.id}:directorio`, outletId: outlet.id, url: e.feedUrl, active: true });
        feeds++;
      }
    }
    await this.events.emit("catalog.imported", { userId: actor.id }, { source: "directorio", outlets, feeds });
    return { outlets, feeds };
  }

  /** Vuelve a leer cada feed del directorio: ¿responde y trae notas? */
  async verify(actorId: string): Promise<{ id: string; name: string; ok: boolean; items: number; error?: string }[]> {
    await this.editor(actorId);
    if (!this.feedReader) throw new ValidationError("No hay lector de feeds configurado.");
    const reader = this.feedReader;
    const results: { id: string; name: string; ok: boolean; items: number; error?: string }[] = [];
    const queue = [...this.entries];
    // De a 4 por vez: rápido, sin cargar a nadie.
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          try {
            const items = (await reader.read(e.feedUrl)).length;
            results.push({ id: e.id, name: e.name, ok: items > 0, items, error: items ? undefined : "No trae notas." });
          } catch (err) {
            results.push({ id: e.id, name: e.name, ok: false, items: 0, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }),
    );
    return this.entries.map((e) => results.find((r) => r.id === e.id)!);
  }

  private pick(ids: string[]): DirectorySource[] {
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError("Elegí al menos una fuente.");
    if (ids.length > MAX_PER_REQUEST) throw new ValidationError(`Hasta ${MAX_PER_REQUEST} por vez.`);
    // En el orden en que se eligieron.
    const chosen = [...new Set(ids)].map((id) => this.entries.find((e) => e.id === id));
    if (chosen.some((e) => !e)) throw new ValidationError("Alguna fuente no está en el directorio.");
    return chosen as DirectorySource[];
  }

  private async editor(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("outlets:write")) throw new AccessDeniedError("No tenés permiso para cargar el catálogo.", "no_permission");
    return u;
  }
}
