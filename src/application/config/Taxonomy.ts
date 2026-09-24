import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { categoryAndDescendants, categoryPath, slugify, type Category, type Topic, type User } from "../../domain/model";
import type { IAuthorizationService, IClock, IDomainEvents, ITaxonomyRepository, IUserRepository } from "../../domain/ports";

export interface CategoryNode extends Category {
  path: string;
  children: CategoryNode[];
  topics: Topic[];
}

/** Forma comparable de un texto: minúsculas, sin tildes ni signos, espacios simples. */
export const topicKey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * TEMAS Y CATEGORÍAS editables.
 * REGLAS:
 *  - Permiso `taxonomy:manage`.
 *  - Categorías jerárquicas sin ciclos; no se desactiva una categoría con temas activos.
 *  - Un tema necesita categoría activa y al menos una palabra clave.
 *  - Nombres y sinónimos no pueden chocar con los de otro tema activo (sería ambiguo:
 *    "gas" no puede significar dos temas).
 *  - No se borra nada: se desactiva (las notas, alertas y estadísticas viejas siguen teniendo sentido).
 */
export class TaxonomyService {
  constructor(
    private readonly repo: ITaxonomyRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  /** Árbol para mostrar (sólo lo activo, salvo que se pida todo). */
  async tree(includeInactive = false): Promise<CategoryNode[]> {
    const cats = (await this.repo.findCategories()).filter((c) => includeInactive || c.active);
    const topics = (await this.repo.findTopics()).filter((t) => includeInactive || t.active);
    const node = (c: Category): CategoryNode => ({
      ...c,
      path: categoryPath(c.id, cats).map((x) => x.name).join(" › "),
      children: cats.filter((x) => x.parentId === c.id).sort(byOrder).map(node),
      topics: topics.filter((t) => t.categoryId === c.id).sort((a, b) => a.name.localeCompare(b.name)),
    });
    return cats.filter((c) => !c.parentId || !cats.some((x) => x.id === c.parentId)).sort(byOrder).map(node);
  }

  async topics(): Promise<Topic[]> {
    return (await this.repo.findTopics()).filter((t) => t.active);
  }

  async saveCategory(input: { actorId: string; id?: string; name: string; parentId?: string; description?: string; order?: number; active?: boolean }): Promise<Category> {
    const actor = await this.manager(input.actorId);
    const name = input.name.trim();
    if (!name) throw new ValidationError("Falta el nombre de la categoría.");
    const cats = await this.repo.findCategories();
    const id = input.id ?? slugify(name);
    if (!id) throw new ValidationError("Nombre inválido.");
    const existing = cats.find((c) => c.id === id);
    if (!input.id && existing) throw new ConflictError(`Ya existe la categoría ${existing.name}.`);
    if (input.parentId) {
      const parent = cats.find((c) => c.id === input.parentId);
      if (!parent) throw new NotFoundError(`No existe la categoría ${input.parentId}.`);
      if (categoryAndDescendants(id, cats).has(input.parentId)) throw new ValidationError("Una categoría no puede quedar dentro de sí misma.");
    }
    const active = input.active ?? existing?.active ?? true;
    if (existing?.active && !active) {
      const inside = categoryAndDescendants(id, cats);
      const live = (await this.repo.findTopics()).filter((t) => t.active && inside.has(t.categoryId));
      if (live.length) throw new ConflictError(`La categoría tiene ${live.length} tema(s) activo(s): movelos o desactivalos primero.`);
    }
    const c: Category = { id, name, parentId: input.parentId, description: input.description, order: input.order ?? existing?.order ?? cats.length + 1, active };
    await this.repo.saveCategory(c);
    await this.events.emit("taxonomy.changed", { userId: actor.id }, { kind: "category", id, active }, { type: "category", id });
    return c;
  }

  async saveTopic(input: { actorId: string; id?: string; name: string; categoryId: string; keywords: string[]; synonyms?: string[]; sensitive?: boolean; countries?: string[]; active?: boolean }): Promise<Topic> {
    const actor = await this.manager(input.actorId);
    const name = input.name.trim().toLowerCase();
    if (!name) throw new ValidationError("Falta el nombre del tema.");
    const id = input.id ?? slugify(name);
    const cat = (await this.repo.findCategories()).find((c) => c.id === input.categoryId);
    if (!cat?.active) throw new ValidationError(`La categoría ${input.categoryId} no existe o no está activa.`);
    const keywords = clean(input.keywords);
    const synonyms = clean(input.synonyms ?? []);
    if (!keywords.length) throw new ValidationError("Un tema necesita al menos una palabra clave para clasificar notas.");
    if (keywords.length > 50 || synonyms.length > 50) throw new ValidationError("Máximo 50 palabras clave y 50 sinónimos.");

    const all = await this.repo.findTopics();
    const existing = all.find((t) => t.id === id);
    if (!input.id && existing) throw new ConflictError(`Ya existe el tema ${existing.name}.`);
    const active = input.active ?? existing?.active ?? true;
    if (active) {
      const mine = new Set([name, ...synonyms].map(topicKey));
      for (const other of all.filter((t) => t.active && t.id !== id)) {
        const clash = [other.name, ...other.synonyms].map(topicKey).find((k) => mine.has(k));
        if (clash) throw new ConflictError(`"${clash}" ya identifica al tema "${other.name}": sería ambiguo.`);
      }
    }
    const t: Topic = {
      id, name, categoryId: cat.id, keywords, synonyms, sensitive: input.sensitive ?? existing?.sensitive ?? false,
      countries: (input.countries ?? existing?.countries ?? []).map((c) => c.toUpperCase()), active, updatedAt: this.clock.now(), updatedBy: actor.id,
    };
    await this.repo.saveTopic(t);
    await this.events.emit("taxonomy.changed", { userId: actor.id }, { kind: "topic", id, active }, { type: "topic", id });
    return t;
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("taxonomy:manage")) throw new AccessDeniedError("No tenés permiso para editar temas y categorías.", "no_permission");
    return u;
  }
}

const byOrder = (a: Category, b: Category) => a.order - b.order || a.name.localeCompare(b.name);
const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];

/** Carga inicial (idempotente: no pisa lo que el equipo ya editó). */
export async function seedTaxonomy(
  repo: ITaxonomyRepository,
  seed: { categories: Omit<Category, "active">[]; topics: { id: string; name: string; categoryId: string; keywords: string[]; synonyms: string[]; sensitive?: boolean }[] },
  now: Date,
): Promise<void> {
  const cats = new Set((await repo.findCategories()).map((c) => c.id));
  for (const c of seed.categories) if (!cats.has(c.id)) await repo.saveCategory({ ...c, active: true });
  const topics = new Set((await repo.findTopics()).map((t) => t.id));
  for (const t of seed.topics) {
    if (!topics.has(t.id)) await repo.saveTopic({ ...t, sensitive: t.sensitive ?? false, countries: [], active: true, updatedAt: now, updatedBy: "sistema" });
  }
}
