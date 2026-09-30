import { AccessDeniedError, ValidationError } from "../../domain/errors";
import type { Article } from "../../domain/model";
import type { IArticleReader, IArticleWriter, IAuthorizationService, IDomainEvents, ITopicClassifier, IUserRepository } from "../../domain/ports";

export type ReclassifyScope = "otros" | "todas";

export interface ReclassifyReport {
  /** Notas revisadas. */
  checked: number;
  /** Notas que cambiaron de tema. */
  changed: number;
  /** Cuántas quedaron en cada tema después (de las revisadas), de mayor a menor. */
  byTopic: { topic: string; articles: number }[];
}

/**
 * VOLVER A CLASIFICAR las notas del catálogo con los temas y palabras clave de hoy (permiso
 * `taxonomy:manage`). Sirve después de sumar temas o palabras: las notas viejas no se enteran solas.
 *  - "otros": sólo las que no tenían tema (lo habitual; no mueve lo que ya estaba clasificado).
 *  - "todas": todas (por ejemplo, después de corregir palabras clave que clasificaban mal).
 * Es idempotente: correrlo dos veces seguidas no cambia nada la segunda. Las afirmaciones no
 * guardan tema (lo toman de la nota), así que alcanza con actualizar la nota.
 */
export class ReclassifyArticlesUseCase {
  constructor(
    private readonly articles: IArticleReader & IArticleWriter,
    private readonly classifier: ITopicClassifier,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
  ) {}

  async execute(actorId: string, scope: ReclassifyScope = "otros"): Promise<ReclassifyReport> {
    const actor = await this.users.findById(actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("taxonomy:manage")) throw new AccessDeniedError("No tenés permiso para reclasificar notas.", "no_permission");
    if (scope !== "otros" && scope !== "todas") throw new ValidationError('Elegí "otros" o "todas".');

    const list = await this.articles.find(scope === "otros" ? { topic: "otros" } : {});
    const changed: Article[] = [];
    const count = new Map<string, number>();
    for (const a of list) {
      const topic = (await this.classifier.classify(`${a.title}. ${a.body}`)) ?? "otros";
      count.set(topic, (count.get(topic) ?? 0) + 1);
      if (topic !== a.topic) changed.push({ ...a, topic });
    }
    await this.articles.saveMany(changed);
    await this.events.emit("articles.reclassified", { userId: actor.id }, { scope, checked: list.length, changed: changed.length });
    return {
      checked: list.length,
      changed: changed.length,
      byTopic: [...count].map(([topic, articles]) => ({ topic, articles })).sort((a, b) => b.articles - a.articles || a.topic.localeCompare(b.topic)),
    };
  }
}
